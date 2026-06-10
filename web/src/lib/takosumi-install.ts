export function yurucommuTakosumiInstallUrl(
  hostname = browserHostname(),
): string {
  // The Takosumi platform worker hosts the install surface at its bare origin
  // (app.takosumi.com in production, app.takosumi.test in local-substrate);
  const installHost = isLocalSubstrateHostname(hostname)
    ? "app.takosumi.test"
    : "app.takosumi.com";
  const url = new URL(`https://${installHost}/install`);
  url.searchParams.set("git", "https://github.com/tako0614/yurucommu.git");
  url.searchParams.set("ref", "main");
  url.searchParams.set("autoplan", "1");
  return url.toString();
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
