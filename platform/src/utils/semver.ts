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
