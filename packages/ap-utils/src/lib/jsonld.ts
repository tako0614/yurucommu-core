export function createContext(extensions: string[] = []): (string | object)[] {
  const entries = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    ...extensions
  ].filter(Boolean);

  return Array.from(new Set(entries));
}

