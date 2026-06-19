import { describe, expect, it } from "vitest";

// Import the function by reading the module directly to test the pure utility.
// We import via dynamic require pattern since the function is exported from the pane seed module.
import { mergeAndDeduplicateMessages } from "../../../../../src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.js";

describe("mergeAndDeduplicateMessages", () => {
  it("returns undefined when both inputs are undefined", () => {
    expect(mergeAndDeduplicateMessages(undefined, undefined)).toBeUndefined();
  });

  it("returns undefined when both inputs are empty strings", () => {
    expect(mergeAndDeduplicateMessages("", "")).toBeUndefined();
  });

  it("returns only bootstrap when kickoff is undefined", () => {
    const result = mergeAndDeduplicateMessages("line1\nline2", undefined);
    expect(result).toBe("line1\nline2");
  });

  it("returns only kickoff when bootstrap is undefined", () => {
    const result = mergeAndDeduplicateMessages(undefined, "lineA\nlineB");
    expect(result).toBe("lineA\nlineB");
  });

  it("merges both sources with bootstrap lines first", () => {
    const result = mergeAndDeduplicateMessages(
      "bootstrap1\nbootstrap2",
      "kickoff1\nkickoff2"
    );
    expect(result).toBe("bootstrap1\nbootstrap2\nkickoff1\nkickoff2");
  });

  it("removes exact duplicate lines across sources", () => {
    const result = mergeAndDeduplicateMessages(
      "common line\nunique bootstrap",
      "common line\nunique kickoff"
    );
    expect(result).toBe("common line\nunique bootstrap\nunique kickoff");
  });

  it("treats lines as duplicates when they differ only by surrounding whitespace", () => {
    const result = mergeAndDeduplicateMessages(
      "  trimmed content  \n  another one  ",
      "trimmed content\nanother one"
    );
    expect(result).toBe("trimmed content\nanother one");
  });

  it("skips empty lines in the output", () => {
    const result = mergeAndDeduplicateMessages(
      "line1\n\nline2",
      "\nline3\n\n"
    );
    expect(result).toBe("line1\nline2\nline3");
  });

  it("preserves order: first occurrence of a line wins regardless of source", () => {
    const result = mergeAndDeduplicateMessages(
      "first\nsecond\nduplicate",
      "duplicate\nthird"
    );
    expect(result).toBe("first\nsecond\nduplicate\nthird");
  });

  it("trims leading/trailing whitespace from the entire input strings", () => {
    const result = mergeAndDeduplicateMessages(
      "\n  \nspace-padded line\n  ",
      "   another line   \n"
    );
    expect(result).toBe("space-padded line\nanother line");
  });

  it("handles single-line inputs without newlines", () => {
    const result = mergeAndDeduplicateMessages(
      "single bootstrap",
      "single kickoff"
    );
    expect(result).toBe("single bootstrap\nsingle kickoff");
  });

  it("returns the trimmed input when only one source is provided", () => {
    const result = mergeAndDeduplicateMessages("  padded line  ", "");
    expect(result).toBe("padded line");
  });
});
