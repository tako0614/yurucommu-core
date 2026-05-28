/**
 * PII / Secret masking for structured logging.
 *
 * Ported from `takos/app/packages/control/src/shared/utils/logger.ts`.
 * Duplicated locally per F26 scope (extraction to a shared package is
 * tracked as a follow-up).
 *
 * Two public helpers:
 *  - `maskSensitiveData(value)`   recursively walks objects/arrays/strings
 *    and returns a masked clone. Object keys matching the SENSITIVE_KEY
 *    regex are replaced with `[redacted]`. Strings are pattern-masked.
 *  - `maskSensitiveString(s)`     pattern-masks a single string.
 *
 * Both helpers are pure and never mutate the input.
 *
 * NOTE: This module deliberately uses `[redacted]` (lowercase) per the
 * F26 spec. Some patterns retain the upstream `[REDACTED_*]` tokens to
 * preserve information about the redacted *kind* (JWT, GHP, PEM, etc).
 */

interface SensitivePattern {
  pattern: RegExp;
  replacement: string;
}

const SENSITIVE_KEY_RE =
  /password|secret|token|apikey|api_key|credential|private|cookie|authorization/i;

const SENSITIVE_PATTERNS: ReadonlyArray<SensitivePattern> = [
  // JWT (header.payload.signature, base64url segments)
  {
    pattern:
      /\beyJ[A-Za-z0-9_-]{1,2048}\.eyJ[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,512}/g,
    replacement: "[REDACTED_JWT]",
  },
  // Bearer / token prefixes
  {
    pattern: /\b(Bearer|token)\s+([A-Za-z0-9_.\-+/=]{16,512})/gi,
    replacement: "$1 [redacted]",
  },
  // Stripe live / test secret keys
  {
    pattern: /\bsk_live_[A-Za-z0-9]{16,256}/g,
    replacement: "[REDACTED_STRIPE_LIVE]",
  },
  {
    pattern: /\bsk_test_[A-Za-z0-9]{16,256}/g,
    replacement: "[REDACTED_STRIPE_TEST]",
  },
  // OpenAI-style sk- tokens
  { pattern: /\bsk-[A-Za-z0-9]{20,256}/g, replacement: "[REDACTED_SK]" },
  // GitHub personal access tokens
  { pattern: /\bghp_[A-Za-z0-9]{20,256}/g, replacement: "[REDACTED_GHP]" },
  { pattern: /\bgho_[A-Za-z0-9]{20,256}/g, replacement: "[REDACTED_GHO]" },
  // AWS access key id
  { pattern: /\bAKIA[0-9A-Z]{16}/g, replacement: "[REDACTED_AWS_ACCESS_KEY]" },
  // PEM private key bodies
  {
    pattern:
      /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|DSA\s+|PGP\s+)?PRIVATE KEY-----[\s\S]{1,16384}?-----END\s+(?:RSA\s+|EC\s+|OPENSSH\s+|DSA\s+|PGP\s+)?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  // password=foo / passwd: bar / secret="baz"
  {
    pattern:
      /\b(password|passwd|pwd|secret|api[_-]?key|apikey|api_token|auth[_-]?token|session[_-]?id|sessionid)\s*[=:]\s*"?([^"\s,}{]{1,256})"?/gi,
    replacement: "$1=[redacted]",
  },
  // Email addresses
  {
    pattern:
      /([A-Za-z0-9._%+\-]{1,64})@([A-Za-z0-9.\-]{1,255}\.[A-Za-z]{2,10})/g,
    replacement: "***@$2",
  },
];

/** Test whether `value` looks like a real credit card via Luhn. */
function isValidLuhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const ch = digits.charCodeAt(i) - 48;
    if (ch < 0 || ch > 9) return false;
    let n = ch;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum > 0 && sum % 10 === 0;
}

/** Mask 13-19 digit numbers that pass Luhn (credit card). */
function maskCreditCards(input: string): string {
  return input.replace(
    /\b(?:\d[ -]?){13,19}\b/g,
    (match) => {
      const digits = match.replace(/[ \-]/g, "");
      if (digits.length < 13 || digits.length > 19) return match;
      if (!isValidLuhn(digits)) return match;
      return "[REDACTED_CC]";
    },
  );
}

/**
 * Pattern-mask a single string.
 *
 * Replaces JWT, Bearer tokens, Stripe / OpenAI / GitHub / AWS secrets,
 * PEM private keys, password/secret/key=value pairs, email addresses,
 * and Luhn-valid credit card numbers.
 */
export function maskSensitiveString(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;
  let result = input;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  result = maskCreditCards(result);
  return result;
}

/**
 * Recursively mask `value`. Returns a masked clone (input is not mutated).
 *
 *  - `string`        -> pattern-masked
 *  - `Array`         -> mapped element-wise
 *  - `Object`        -> key/value walked; values for sensitive keys are
 *                       replaced with `"[redacted]"`
 *  - Other primitives are returned unchanged.
 *
 * Cycle-safe via a WeakSet on the walk path.
 */
export function maskSensitiveData(value: unknown): unknown {
  return walk(value, new WeakSet<object>());
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return maskSensitiveString(value);
  if (typeof value !== "object") return value;

  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, seen));
  }

  // Preserve Error shape (name/message/stack) but mask string fields.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskSensitiveString(value.message),
      stack: value.stack ? maskSensitiveString(value.stack) : undefined,
    };
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = walk(child, seen);
  }
  return out;
}
