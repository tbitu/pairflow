import {
  respawnTmuxPaneCommand
} from "./tmuxManager.js";
import {
  maybeAcceptOpencodeTrustPrompt,
  sendAndSubmitTmuxPaneMessage,
  submitTmuxPaneInput
} from "./tmuxInput.js";

export const acceptMetaReviewTrustPrompt = maybeAcceptOpencodeTrustPrompt;
export const sendMetaReviewSubmissionRequest = sendAndSubmitTmuxPaneMessage;
export const submitMetaReviewInput = submitTmuxPaneInput;
export const respawnMetaReviewPane = respawnTmuxPaneCommand;
