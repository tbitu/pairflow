import {
  respawnTmuxPaneCommand
} from "./tmuxManager.js";
import { sendAndSubmitTmuxPaneMessage } from "./tmuxPaneWrite.js";
import { confirmTmuxPaneMarkerSubmission } from "./tmuxPaneMarkerConfirmation.js";
import { deactivateOtherRolePanes } from "../../../shared/channel/rolePaneLifecycle.js";
import { waitForAgentPaneReady } from "./tmuxPaneReadiness.js";
import { resolveAgentPaneAdapter } from "./agentPaneAdapters.js";

export const sendMetaReviewSubmissionRequest = sendAndSubmitTmuxPaneMessage;
export const confirmMetaReviewSubmission = confirmTmuxPaneMarkerSubmission;
export const respawnMetaReviewPane = respawnTmuxPaneCommand;
export const deactivateOtherMetaReviewPanes = deactivateOtherRolePanes;
export const waitForMetaReviewPaneReady = waitForAgentPaneReady;
export const resolveMetaReviewAgentPaneAdapter = resolveAgentPaneAdapter;
