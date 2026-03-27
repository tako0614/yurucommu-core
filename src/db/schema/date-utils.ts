/** ISO timestamp with space separator for SQLite default values. */
export function nowIso(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}
