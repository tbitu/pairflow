// Phase 4: Prompts are consolidated. All agents reconstruct from metadata instead.
// Removed dead functions: shouldSubmitStartupPrompt, resolveBootstrapStartupPrompt, 
// resolveResumeBootstrapStartupPrompt, resolveResumeBootstrapStartupMessages, resolveBootstrapStartupMessages

export function resolveCommandStartupPrompt(
  _agentName: string,
  startupPrompt: string | undefined
): string | undefined {
  return startupPrompt;
}
