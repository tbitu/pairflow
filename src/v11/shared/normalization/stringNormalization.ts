export function normalizeStringList(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0)
    )
  ];
}

export function requireNonEmptyString(
  value: string,
  fieldName: string,
  errorFactory: PairflowCreateCommandError
): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw errorFactory(`${fieldName} cannot be empty.`);
  }

  return normalized;
}

/**
 * Trims leading/trailing whitespace and strips trailing slashes.
 * Used for model names that may contain trailing slashes from config values.
 */
export function trimAndStripTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
