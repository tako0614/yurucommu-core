import { assertEquals } from "#test/assert";
import { test } from "bun:test";
import { yurucommuTakosumiInstallUrl } from "./takosumi-install.ts";

test("yurucommu Takosumi install URL targets production accounts with source intent", () => {
  const url = new URL(yurucommuTakosumiInstallUrl("yurucommu.com"));

  assertEquals(url.origin, "https://accounts.takosumi.com");
  assertEquals(url.pathname, "/apps/install");
  assertEquals(
    url.searchParams.get("git"),
    "https://github.com/tako0614/yurucommu.git",
  );
  assertEquals(url.searchParams.get("ref"), "main");
  assertEquals(url.searchParams.get("mode"), "shared-cell");
  assertEquals(url.searchParams.get("autodryrun"), "1");
});

test("yurucommu Takosumi install URL rewrites to local-substrate on .test hosts", () => {
  const url = new URL(yurucommuTakosumiInstallUrl("yurucommu.test"));

  assertEquals(url.origin, "https://accounts.takosumi.test");
  assertEquals(url.pathname, "/apps/install");
  assertEquals(
    url.searchParams.get("git"),
    "https://github.com/tako0614/yurucommu.git",
  );
  assertEquals(url.searchParams.get("ref"), "main");
  assertEquals(url.searchParams.get("mode"), "shared-cell");
  assertEquals(url.searchParams.get("autodryrun"), "1");
});
