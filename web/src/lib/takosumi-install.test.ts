import { assertEquals } from "#test/assert";
import { test } from "bun:test";
import { yurucommuTakosumiInstallUrl } from "./takosumi-install.ts";

test("yurucommu Takosumi install URL targets the platform worker with source intent", () => {
  const url = new URL(yurucommuTakosumiInstallUrl("yurucommu.com"));

  assertEquals(url.origin, "https://app.takosumi.com");
  assertEquals(url.pathname, "/install");
  assertEquals(
    url.searchParams.get("git"),
    "https://github.com/tako0614/yurucommu.git",
  );
  assertEquals(url.searchParams.get("ref"), "main");
  assertEquals(url.searchParams.get("mode"), null);
  assertEquals(url.searchParams.get("autoplan"), "1");
});

test("yurucommu Takosumi install URL rewrites to local-substrate on .test hosts", () => {
  const url = new URL(yurucommuTakosumiInstallUrl("yurucommu.test"));

  assertEquals(url.origin, "https://app.takosumi.test");
  assertEquals(url.pathname, "/install");
  assertEquals(
    url.searchParams.get("git"),
    "https://github.com/tako0614/yurucommu.git",
  );
  assertEquals(url.searchParams.get("ref"), "main");
  assertEquals(url.searchParams.get("mode"), null);
  assertEquals(url.searchParams.get("autoplan"), "1");
});
