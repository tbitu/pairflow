#!/usr/bin/env python3
"""
tcpproxy: OpenAI-compatible mediation proxy for Pairflow.
Intercepts requests from Opencode and Reasonix, maps virtual Pairflow role model IDs
(pairflow-implementer, pairflow-reviewer, pairflow-meta-reviewer) to concrete backend models,
injects role-specific sampling hyperparameters, and proxies traffic to the host LLM server.
"""

import http.client
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

# ==============================================================================
# PARAMETERS & ENVIRONMENT CONFIGURATION
# ==============================================================================
UPSTREAM_URL = os.environ.get("UPSTREAM_URL", "http://host.docker.internal:11434/v1")
parsed = urlparse(UPSTREAM_URL)
UPSTREAM_SCHEME = (parsed.scheme or "http").lower()
UPSTREAM_HOST = parsed.hostname or "host.docker.internal"
UPSTREAM_PORT = parsed.port or (443 if UPSTREAM_SCHEME == "https" else 80)
UPSTREAM_BASE_PATH = parsed.path.rstrip("/")
UPSTREAM_API_KEY = os.environ.get("UPSTREAM_API_KEY", "")

BACKEND = os.environ.get("BACKEND", "ollama").lower()
MANAGE_MODELS = (BACKEND == "lmstudio")

DEFAULT_MODEL = os.environ.get("TARGET_MODEL", "qwen3.8-27b:q8_0")
MODEL_MAP = {
    "pairflow-implementer": os.environ.get("IMPLEMENTER_MODEL", DEFAULT_MODEL),
    "pairflow-reviewer": os.environ.get("REVIEWER_MODEL", DEFAULT_MODEL),
    "pairflow-meta-reviewer": os.environ.get("META_REVIEWER_MODEL", DEFAULT_MODEL),
}

LISTEN_HOST = os.environ.get("LISTEN_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "1235"))
LOG_FILE = os.environ.get("LOG_FILE", "/tmp/tcpproxy.log")

LOG = open(LOG_FILE, "a", buffering=1)

# Role-specific sampling parameters (Qwen recommended defaults)
ROLE_PARAMS = {
    "implementer": {
        "temperature": float(os.environ.get("PARAM_IMPL_TEMP", 0.6)),
        "top_p": 0.95,
        "top_k": 20,
    },
    "reviewer": {
        "temperature": float(os.environ.get("PARAM_REV_TEMP", 1.0)),
        "top_p": 0.95,
        "top_k": 20,
    },
    "meta_reviewer": {
        "temperature": float(os.environ.get("PARAM_META_TEMP", 0.7)),
        "top_p": 0.95,
        "top_k": 20,
    },
}

_current_model_lock = threading.Lock()


def _get_connection():
    if UPSTREAM_SCHEME == "https":
        return http.client.HTTPSConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=900)
    return http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=900)


def _map_model_name(model: str) -> str:
    return MODEL_MAP.get(model, model)


def _ensure_model_loaded(model: str) -> None:
    if not MANAGE_MODELS:
        return
    actual_model = _map_model_name(model)
    with _current_model_lock:
        try:
            conn = _get_connection()
            models_path = f"{UPSTREAM_BASE_PATH}/models" if UPSTREAM_BASE_PATH else "/api/v1/models"
            conn.request("GET", models_path)
            res = conn.getresponse()
            data = json.loads(res.read().decode("utf-8"))
            conn.close()

            instances_to_unload = []
            target_loaded = False
            for m in data.get("models", []):
                key = m.get("key")
                insts = m.get("loaded_instances", [])
                if key == actual_model and insts:
                    target_loaded = True
                elif m.get("type") in ("llm", "vlm"):
                    for inst in insts:
                        if inst.get("id"):
                            instances_to_unload.append((key, inst.get("id")))

            unload_path = f"{UPSTREAM_BASE_PATH}/models/unload" if UPSTREAM_BASE_PATH else "/api/v1/models/unload"
            for m_key, inst_id in instances_to_unload:
                conn = _get_connection()
                conn.request("POST", unload_path,
                             json.dumps({"instance_id": inst_id}), {"Content-Type": "application/json"})
                conn.getresponse().read()
                conn.close()

            if not target_loaded:
                load_path = f"{UPSTREAM_BASE_PATH}/models/load" if UPSTREAM_BASE_PATH else "/api/v1/models/load"
                conn = _get_connection()
                conn.request("POST", load_path,
                             json.dumps({"model": actual_model}), {"Content-Type": "application/json"})
                conn.getresponse().read()
                conn.close()
        except Exception as ex:
            LOG.write(f"LM Studio model management error: {ex}\n")


def _rewrite_payload(path: str, payload: bytes) -> bytes:
    if not payload or not any(p in path for p in ("/responses", "/chat/completions", "/completions")):
        return payload
    try:
        body = json.loads(payload.decode("utf-8"))
    except Exception:
        return payload

    model = body.get("model", "")
    actual_model = _map_model_name(model)
    _ensure_model_loaded(actual_model)
    body["model"] = actual_model

    role = None
    if "implementer" in model:
        role = "implementer"
    elif "meta_reviewer" in model or "meta-reviewer" in model:
        role = "meta_reviewer"
    elif "reviewer" in model:
        role = "reviewer"

    if role and role in ROLE_PARAMS:
        for k, v in ROLE_PARAMS[role].items():
            body[k] = v
        if "options" not in body or not isinstance(body["options"], dict):
            body["options"] = {}
        for k, v in ROLE_PARAMS[role].items():
            body["options"][k] = v
        LOG.write(f"REQ: mapped model={model} -> {actual_model}, role={role}, params={ROLE_PARAMS[role]}\n")
    else:
        LOG.write(f"REQ: mapped model={model} -> {actual_model}, role={role}\n")

    return json.dumps(body).encode("utf-8")


def _rewrite_models_response(payload: bytes) -> bytes:
    try:
        body = json.loads(payload.decode("utf-8"))
    except Exception:
        body = {"object": "list", "data": []}

    data = body.get("data", [])
    if not isinstance(data, list):
        data = []

    existing_ids = {m.get("id") for m in data if isinstance(m, dict)}
    for logical_name in MODEL_MAP.keys():
        if logical_name not in existing_ids:
            data.append({
                "id": logical_name,
                "object": "model",
                "owned_by": "pairflow-phase",
                "permission": []
            })
    body["data"] = data
    return json.dumps(body).encode("utf-8")


def _resolve_forward_path(path: str) -> str:
    base = UPSTREAM_BASE_PATH
    if not base:
        return path
    if path.startswith(base):
        return path
    return f"{base}{path}"


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_args) -> None:
        return

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def _handle(self, method: str):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            content_length = 0

        request_body = self.rfile.read(content_length) if content_length > 0 else b""
        request_body = _rewrite_payload(self.path, request_body)
        forward_path = _resolve_forward_path(self.path)

        forward_headers = {}
        for k, v in self.headers.items():
            if k.lower() not in (
                "host", "connection", "proxy-connection", "keep-alive",
                "transfer-encoding", "upgrade", "content-length", "accept-encoding"
            ):
                forward_headers[k] = v

        forward_headers["Host"] = f"{UPSTREAM_HOST}:{UPSTREAM_PORT}"
        forward_headers["Connection"] = "close"
        forward_headers["Accept-Encoding"] = "identity"

        if UPSTREAM_API_KEY and "authorization" not in {k.lower() for k in forward_headers}:
            forward_headers["Authorization"] = f"Bearer {UPSTREAM_API_KEY}"

        if method == "POST":
            forward_headers["Content-Length"] = str(len(request_body))

        conn = _get_connection()
        try:
            conn.request(method, forward_path, body=request_body if method == "POST" else None, headers=forward_headers)
            upstream_response = conn.getresponse()

            if method == "GET" and "/models" in self.path:
                raw = upstream_response.read()
                rewritten = _rewrite_models_response(raw)
                self.send_response(upstream_response.status, upstream_response.reason)
                for key, value in upstream_response.getheaders():
                    if key.lower() not in ("content-length", "transfer-encoding", "connection", "accept-encoding"):
                        self.send_header(key, value)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(rewritten)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(rewritten)
                return

            self.send_response(upstream_response.status, upstream_response.reason)
            for key, value in upstream_response.getheaders():
                if key.lower() not in ("content-length", "transfer-encoding", "connection", "accept-encoding"):
                    self.send_header(key, value)
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Connection", "close")
            self.end_headers()

            while True:
                chunk = upstream_response.read(65536)
                if not chunk:
                    break
                self.wfile.write(f"{len(chunk):X}\r\n".encode("ascii") + chunk + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()

        except Exception as ex:
            LOG.write(f"Proxy forward failed to {UPSTREAM_HOST}:{UPSTREAM_PORT}{forward_path}: {ex}\n")
            if method == "GET" and "/models" in self.path:
                # Upstream might be starting or unreachable; return fallback synthetic models list
                synthetic = _rewrite_models_response(b'{"object":"list","data":[]}')
                self.send_response(200, "OK")
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(synthetic)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(synthetic)
                return
            try:
                self.send_error(502, f"Bad Gateway: upstream {UPSTREAM_HOST}:{UPSTREAM_PORT} unreachable ({ex})")
            except Exception:
                pass
        finally:
            conn.close()


if __name__ == "__main__":
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), ProxyHandler)
    msg = f"tcpproxy listening on {LISTEN_HOST}:{LISTEN_PORT} -> {UPSTREAM_URL} (Target Model: {DEFAULT_MODEL}, Backend: {BACKEND})"
    print(msg, flush=True)
    LOG.write(f"{msg}\n")
    server.serve_forever()
