import {
  respawnTmuxPaneCommand
} from "./tmuxManager.js";
import {
  maybeAcceptOpencodeTrustPrompt,
  sendAndSubmitTmuxPaneMessage,
  submitTmuxPaneInput
} from "./tmuxInput.js";
import { deactivateOtherRolePanes } from "../../../shared/channel/rolePaneLifecycle.js";
import { waitForAgentPaneReady } from "./tmuxPaneReadiness.js";

export const acceptMetaReviewTrustPrompt = maybeAcceptOpencodeTrustPrompt;
export const sendMetaReviewSubmissionRequest = sendAndSubmitTmuxPaneMessage;
export const submitMetaReviewInput = submitTmuxPaneInput;
export const respawnMetaReviewPane = respawnTmuxPaneCommand;
export const deactivateOtherMetaReviewPanes = deactivateOtherRolePanes;
export const waitForMetaReviewPaneReady = waitForAgentPaneReady;
