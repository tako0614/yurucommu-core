export async function req<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch { /* ignore */ }
    const msg = (data as { error?: string } | null)?.error ?? res.statusText;
    throw new Error(msg);
  }
  return res.json();
}
