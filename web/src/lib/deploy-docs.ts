export function yurucommuDeployDocsUrl(hostname = browserHostname()): string {
  const docsHost = isLocalSubstrateHostname(hostname)
    ? "yurucommu.test"
    : "yurucommu.com";
  return `https://${docsHost}/help/deployment.html`;
}

function browserHostname(): string {
  return typeof location === "undefined" ? "" : location.hostname;
}

function isLocalSubstrateHostname(hostname: string): boolean {
  return (
    hostname.endsWith(".test") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}
