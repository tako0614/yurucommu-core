export async function req<T>(
  path: string,
  method = "GET",
  body?: FormData | unknown,
): Promise<T> {
  const opts: RequestInit = { method };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
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
