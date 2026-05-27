import { assertEquals } from "jsr:@std/assert";
import { yurucommuTakosumiCloudInstallUrl } from "./takosumi-cloud-install.ts";

Deno.test("yurucommu Cloud install URL targets production Cloud with source intent", () => {
  const url = new URL(yurucommuTakosumiCloudInstallUrl("yurucommu.com"));

  assertEquals(url.origin, "https://cloud.takosumi.com");
  assertEquals(url.pathname, "/apps/install");
  assertEquals(
    url.searchParams.get("git"),
    "https://github.com/tako0614/yurucommu.git",
  );
  assertEquals(url.searchParams.get("ref"), "main");
  assertEquals(url.searchParams.get("mode"), "shared-cell");
  assertEquals(url.searchParams.get("autodryrun"), "1");
});

Deno.test("yurucommu Cloud install URL rewrites to local-substrate on .test hosts", () => {
  const url = new URL(yurucommuTakosumiCloudInstallUrl("yurucommu.test"));

  assertEquals(url.origin, "https://cloud.takosumi.test");
  assertEquals(url.pathname, "/apps/install");
  assertEquals(
    url.searchParams.get("git"),
    "https://github.com/tako0614/yurucommu.git",
  );
  assertEquals(url.searchParams.get("ref"), "main");
  assertEquals(url.searchParams.get("mode"), "shared-cell");
  assertEquals(url.searchParams.get("autodryrun"), "1");
});
