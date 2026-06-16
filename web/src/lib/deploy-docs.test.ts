import { assertEquals } from "#test/assert";
import { test } from "bun:test";
import { yurucommuDeployDocsUrl } from "./deploy-docs.ts";

test("yurucommu deploy docs URL targets the public deployment guide", () => {
  const url = new URL(yurucommuDeployDocsUrl("yurucommu.com"));

  assertEquals(url.origin, "https://yurucommu.com");
  assertEquals(url.pathname, "/help/deployment.html");
});

test("yurucommu deploy docs URL rewrites to local-substrate on .test hosts", () => {
  const url = new URL(yurucommuDeployDocsUrl("yurucommu.test"));

  assertEquals(url.origin, "https://yurucommu.test");
  assertEquals(url.pathname, "/help/deployment.html");
});
