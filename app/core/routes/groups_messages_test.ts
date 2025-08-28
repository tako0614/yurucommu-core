function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`${actual} !== ${expected}`);
  }
}

function toGroupId(raw: string, domain: string): string {
  const decoded = decodeURIComponent(raw);
  if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
    return decoded;
  }
  if (decoded.includes("@")) {
    const [name, host] = decoded.split("@");
    if (name && host) return `https://${host}/groups/${name}`;
  }
  return `https://${domain}/groups/${decoded}`;
}

Deno.test("name@host 形式のグループID解決", () => {
  assertEquals(
    toGroupId("test@example.net", "example.com"),
    "https://example.net/groups/test",
  );
});

Deno.test("ローカルグループIDの解決", () => {
  assertEquals(
    toGroupId("local", "example.com"),
    "https://example.com/groups/local",
  );
});
