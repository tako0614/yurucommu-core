export type AppCodeInspectionIssue = {
  kind: "dangerous_pattern";
  pattern: "eval" | "new_function" | "dynamic_import" | "disallowed_import";
  specifier?: string;
  message: string;
};

const findMatch = (code: string, re: RegExp): boolean => {
  re.lastIndex = 0;
  return re.test(code);
};

export function inspectAppScriptCode(
  code: string,
  options?: { allowedImports?: string[] },
): AppCodeInspectionIssue[] {
  const issues: AppCodeInspectionIssue[] = [];
  const text = String(code ?? "");

  const allowedImports = (options?.allowedImports ?? []).map((v) => v.trim()).filter(Boolean);

  if (findMatch(text, /\beval\s*\(/g)) {
    issues.push({
      kind: "dangerous_pattern",
      pattern: "eval",
      message: "Dangerous pattern detected: eval()",
    });
  }

  if (findMatch(text, /\bnew\s+Function\s*\(/g)) {
    issues.push({
      kind: "dangerous_pattern",
      pattern: "new_function",
      message: "Dangerous pattern detected: new Function()",
    });
  }

  if (findMatch(text, /\bimport\s*\(/g)) {
    issues.push({
      kind: "dangerous_pattern",
      pattern: "dynamic_import",
      message: "Dangerous pattern detected: dynamic import()",
    });
  }

  if (allowedImports.length > 0) {
    const importSpecifiers = new Set<string>();
    const add = (value: string | undefined) => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (trimmed) importSpecifiers.add(trimmed);
    };

    for (const match of text.matchAll(/\bimport\s+[^;]*?\bfrom\s+["']([^"']+)["']/g)) {
      add(match[1]);
    }
    for (const match of text.matchAll(/\bexport\s+[^;]*?\bfrom\s+["']([^"']+)["']/g)) {
      add(match[1]);
    }
    for (const match of text.matchAll(/\bimport\s+["']([^"']+)["']/g)) {
      add(match[1]);
    }

    for (const specifier of importSpecifiers) {
      if (!allowedImports.includes(specifier)) {
        issues.push({
          kind: "dangerous_pattern",
          pattern: "disallowed_import",
          specifier,
          message: `Disallowed import "${specifier}". Allowed imports: ${allowedImports.join(", ")}`,
        });
      }
    }
  }

  return issues;
}
