export type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
};

export type SemverCompatibility = {
  ok: boolean;
  warnings: string[];
  error?: string;
};

export type SemverCheckOptions = {
  allowMajorMismatch?: boolean;
  context?: string;
  action?: string;
};

const SEMVER_REGEX = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/;
const RANGE_PART_REGEX = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){1,2}(?:[-+].*)?)$/;

export function parseSemver(version: string): ParsedSemver | null {
  const match = (version || "").trim().match(SEMVER_REGEX);
  if (!match) return null;
  const [, major, minor, patch] = match;
  const majorNum = Number(major);
  const minorNum = Number(minor);
  const patchNum = Number(patch ?? "0");

  if ([majorNum, minorNum, patchNum].some((value) => Number.isNaN(value))) {
    return null;
  }

  return {
    major: majorNum,
    minor: minorNum,
    patch: patchNum,
  };
}

export function checkSemverCompatibility(
  currentVersion: string,
  incomingVersion: string,
  options: SemverCheckOptions = {},
): SemverCompatibility {
  const warnings: string[] = [];
  const current = parseSemver(currentVersion);
  const incoming = parseSemver(incomingVersion);
  const context = options.context || "version";

  if (!current || !incoming) {
    return { ok: false, warnings, error: `${context} must be SemVer` };
  }

  if (incoming.major !== current.major) {
    if (!options.allowMajorMismatch) {
      return {
        ok: false,
        warnings,
        error: `major version mismatch: ${currentVersion} vs ${incomingVersion}`,
      };
    }
    const action = options.action ?? "update";
    warnings.push(
      `forced ${action} across major versions (${currentVersion} -> ${incomingVersion})`,
    );
    return { ok: true, warnings };
  }

  if (incoming.minor !== current.minor) {
    warnings.push(
      `minor version differs (${currentVersion} -> ${incomingVersion}); review compatibility`,
    );
    return { ok: true, warnings };
  }

  if (incoming.patch !== current.patch) {
    warnings.push(`patch version differs (${currentVersion} -> ${incomingVersion})`);
  }

  return { ok: true, warnings };
}

const compareSemver = (a: ParsedSemver, b: ParsedSemver): number => {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
};

/**
 * Check whether a version satisfies a simple SemVer range.
 * Supports space-delimited comparator segments (e.g. ">=1.3.0 <2.0.0") or a single
 * version string (delegates to checkSemverCompatibility for warnings).
 */
export function checkSemverRange(
  currentVersion: string,
  range: string,
  options: SemverCheckOptions = {},
): SemverCompatibility {
  const warnings: string[] = [];
  const context = options.context || "version";
  const trimmed = (range || "").trim();

  if (!trimmed) {
    return { ok: false, warnings, error: `${context} must be SemVer` };
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const hasComparator = parts.some((part) => /^[<>]=?|=/.test(part));

  // Single version without comparators -> use compatibility check for richer warnings
  if (!hasComparator && parts.length === 1) {
    return checkSemverCompatibility(currentVersion, parts[0], options);
  }

  const current = parseSemver(currentVersion);
  if (!current) {
    return { ok: false, warnings, error: `${context} must be SemVer` };
  }

  for (const part of parts) {
    const match = part.match(RANGE_PART_REGEX);
    if (!match) {
      return {
        ok: false,
        warnings,
        error: `${context} range segment "${part}" is invalid`,
      };
    }

    const [, operator, candidate] = match;
    const target = parseSemver(candidate);
    if (!target) {
      return {
        ok: false,
        warnings,
        error: `${context} range segment "${part}" is invalid`,
      };
    }

    if (!operator || operator === "=") {
      const equality = checkSemverCompatibility(currentVersion, candidate, options);
      if (!equality.ok) {
        return { ok: false, warnings: [...warnings, ...equality.warnings], error: equality.error };
      }
      warnings.push(...equality.warnings);
      continue;
    }

    const compare = compareSemver(current, target);
    let satisfied = false;

    switch (operator) {
      case ">":
        satisfied = compare > 0;
        break;
      case ">=":
        satisfied = compare >= 0;
        break;
      case "<":
        satisfied = compare < 0;
        break;
      case "<=":
        satisfied = compare <= 0;
        break;
      default:
        return {
          ok: false,
          warnings,
          error: `${context} range segment "${part}" is invalid`,
        };
    }

    if (!satisfied) {
      return {
        ok: false,
        warnings,
        error: `${context} ${currentVersion} does not satisfy ${part}`,
      };
    }
  }

  return { ok: true, warnings };
}
