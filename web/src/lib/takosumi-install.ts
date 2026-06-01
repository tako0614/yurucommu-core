export function yurucommuTakosumiInstallUrl(
  hostname = browserHostname(),
): string {
  const installHost = isLocalSubstrateHostname(hostname)
    ? "accounts.takosumi.test"
    : "accounts.takosumi.com";
  const url = new URL(`https://${installHost}/apps/install`);
  url.searchParams.set("git", "https://github.com/tako0614/yurucommu.git");
  url.searchParams.set("ref", "main");
  url.searchParams.set("mode", "shared-cell");
  url.searchParams.set("autodryrun", "1");
  return url.toString();
}

function browserHostname(): string {
  return typeof location === "undefined" ? "" : location.hostname;
}

function isLocalSubstrateHostname(hostname: string): boolean {
  return hostname.endsWith(".test") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";
}
