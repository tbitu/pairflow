import {
  agentNames,
  isAgentName,
  type AgentName
} from "../../contracts/kernel/agentIdentity.js";
import { isInteger, isRecord, type ValidationError } from "../../v11/shared/validation/primitives.js";

export type WatchdogTimeoutMinutesByAgent = Partial<Record<AgentName, number>>;

/**
 * Optional per-agent watchdog timeout override, keyed by agent name (e.g. a
 * local-LLM-backed agent that legitimately needs longer than the flat
 * `watchdog_timeout_minutes` default). Falls back to the flat value for any
 * agent not present in the map.
 */
export function validateWatchdogTimeoutMinutesByAgent(
  input: unknown,
  path: string,
  errors: ValidationError[]
): WatchdogTimeoutMinutesByAgent | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    errors.push({ path, message: "Must be an object/section" });
    return undefined;
  }

  const validated: WatchdogTimeoutMinutesByAgent = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isAgentName(key)) {
      errors.push({
        path: `${path}.${key}`,
        message: `Must be one of: ${agentNames.join(", ")}`
      });
      continue;
    }
    if (!isInteger(value) || value <= 0) {
      errors.push({
        path: `${path}.${key}`,
        message: "Must be a positive integer"
      });
      continue;
    }
    validated[key] = value;
  }

  return Object.keys(validated).length > 0 ? validated : undefined;
}
