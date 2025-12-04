/**
 * Unified Diff Application Utility
 *
 * Applies unified diff patches to text content.
 * Supports standard unified diff format (e.g., from `git diff` or `diff -u`).
 */

export interface DiffHunk {
  /** Original file start line (1-based) */
  oldStart: number;
  /** Original file line count */
  oldCount: number;
  /** New file start line (1-based) */
  newStart: number;
  /** New file line count */
  newCount: number;
  /** Hunk content lines (each prefixed with ' ', '+', or '-') */
  lines: string[];
}

export interface ParsedDiff {
  /** Original file path (from --- header) */
  oldPath: string | null;
  /** New file path (from +++ header) */
  newPath: string | null;
  /** Parsed hunks */
  hunks: DiffHunk[];
}

export interface ApplyDiffResult {
  success: boolean;
  content: string;
  error?: string;
  /** Lines that couldn't be matched exactly */
  warnings?: string[];
}

/**
 * Parse a unified diff string into structured hunks
 */
export function parseUnifiedDiff(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");
  const result: ParsedDiff = {
    oldPath: null,
    newPath: null,
    hunks: [],
  };

  let i = 0;

  // Skip any leading lines until we find --- or @@
  while (i < lines.length) {
    const line = lines[i];

    // Parse --- header (old file path)
    if (line.startsWith("---")) {
      const match = line.match(/^---\s+(.+?)(?:\t|$)/);
      if (match) {
        result.oldPath = match[1].replace(/^[ab]\//, "");
      }
      i++;
      continue;
    }

    // Parse +++ header (new file path)
    if (line.startsWith("+++")) {
      const match = line.match(/^\+\+\+\s+(.+?)(?:\t|$)/);
      if (match) {
        result.newPath = match[1].replace(/^[ab]\//, "");
      }
      i++;
      continue;
    }

    // Parse @@ hunk header
    if (line.startsWith("@@")) {
      const hunkMatch = line.match(
        /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
      );
      if (hunkMatch) {
        const hunk: DiffHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
          newStart: parseInt(hunkMatch[3], 10),
          newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
          lines: [],
        };

        i++;

        // Collect hunk content lines
        while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff ")) {
          const contentLine = lines[i];
          // Only include lines that are context, addition, or deletion
          if (
            contentLine.startsWith(" ") ||
            contentLine.startsWith("+") ||
            contentLine.startsWith("-") ||
            contentLine === ""
          ) {
            hunk.lines.push(contentLine);
          } else if (contentLine.startsWith("\\")) {
            // "\ No newline at end of file" - skip
          } else {
            // End of hunk
            break;
          }
          i++;
        }

        result.hunks.push(hunk);
        continue;
      }
    }

    // Skip other lines (diff headers, etc.)
    i++;
  }

  return result;
}

/**
 * Apply a parsed diff to the original content
 */
export function applyDiff(original: string, diff: ParsedDiff): ApplyDiffResult {
  const warnings: string[] = [];

  if (diff.hunks.length === 0) {
    return { success: true, content: original, warnings: ["No hunks found in diff"] };
  }

  const originalLines = original.split("\n");
  const resultLines: string[] = [];

  // Current position in original file (0-based)
  let originalPos = 0;

  for (const hunk of diff.hunks) {
    // Convert to 0-based index
    const hunkStartIndex = hunk.oldStart - 1;

    // Copy lines before this hunk
    while (originalPos < hunkStartIndex && originalPos < originalLines.length) {
      resultLines.push(originalLines[originalPos]);
      originalPos++;
    }

    // Apply the hunk
    let oldLinesConsumed = 0;

    for (const line of hunk.lines) {
      if (line.startsWith("-")) {
        // Deletion: skip original line
        const expectedLine = line.slice(1);
        if (originalPos < originalLines.length) {
          const actualLine = originalLines[originalPos];
          if (actualLine !== expectedLine) {
            warnings.push(
              `Line ${originalPos + 1}: expected "${expectedLine.slice(0, 40)}..." but got "${actualLine.slice(0, 40)}..."`
            );
          }
        }
        originalPos++;
        oldLinesConsumed++;
      } else if (line.startsWith("+")) {
        // Addition: add new line
        resultLines.push(line.slice(1));
      } else if (line.startsWith(" ") || line === "") {
        // Context: copy from original (verify it matches)
        const expectedLine = line.startsWith(" ") ? line.slice(1) : "";
        if (originalPos < originalLines.length) {
          const actualLine = originalLines[originalPos];
          if (actualLine !== expectedLine) {
            warnings.push(
              `Context mismatch at line ${originalPos + 1}: expected "${expectedLine.slice(0, 40)}..." but got "${actualLine.slice(0, 40)}..."`
            );
          }
          resultLines.push(originalLines[originalPos]);
        } else {
          resultLines.push(expectedLine);
        }
        originalPos++;
        oldLinesConsumed++;
      }
    }
  }

  // Copy remaining lines after the last hunk
  while (originalPos < originalLines.length) {
    resultLines.push(originalLines[originalPos]);
    originalPos++;
  }

  return {
    success: warnings.length === 0,
    content: resultLines.join("\n"),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Apply a unified diff string to the original content
 */
export function applyUnifiedDiff(original: string, diffText: string): ApplyDiffResult {
  try {
    const parsed = parseUnifiedDiff(diffText);
    return applyDiff(original, parsed);
  } catch (error) {
    return {
      success: false,
      content: original,
      error: `Failed to parse diff: ${(error as Error).message}`,
    };
  }
}

/**
 * Check if a string looks like a unified diff
 */
export function isUnifiedDiff(text: string): boolean {
  // Must contain at least one hunk header
  return /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m.test(text);
}

/**
 * Apply a patch to content, supporting multiple formats:
 * - "replace:" prefix for full replacement
 * - Unified diff format
 * - Otherwise, append to original
 */
export function applyPatch(
  original: string,
  patch: string
): ApplyDiffResult {
  // Full replacement
  if (patch.startsWith("replace:")) {
    return {
      success: true,
      content: patch.slice("replace:".length),
    };
  }

  // Unified diff
  if (isUnifiedDiff(patch)) {
    return applyUnifiedDiff(original, patch);
  }

  // Default: append (legacy behavior)
  return {
    success: true,
    content: original + "\n" + patch,
    warnings: ["Patch does not appear to be unified diff format; content was appended"],
  };
}
