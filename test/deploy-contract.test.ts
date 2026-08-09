import { expect, test } from "bun:test";

test("package-family deploy entrypoint exposes a side-effect-free contract", () => {
  const result = Bun.spawnSync({
    cmd: ["bun", "scripts/deploy.mjs", "--contract"],
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toBe("");

  const contract = JSON.parse(new TextDecoder().decode(result.stdout)) as {
    kind: string;
    surfaces: Array<{
      surface: string;
      triggers: string[];
      requiresScripts: string[];
      obligations: Record<string, string>;
    }>;
  };
  expect(contract.kind).toBe("takos.deploy-contract@v2");
  expect(contract.surfaces).toHaveLength(1);
  expect(contract.surfaces[0]?.surface).toBe("yurucommu-package-family");
  expect(contract.surfaces[0]?.triggers).toEqual(["published-identity"]);
  expect(contract.surfaces[0]?.requiresScripts).toEqual([
    "check",
    "check:packed-consumer",
  ]);
  expect(contract.surfaces[0]?.obligations["no-overwrite"]).toBeTruthy();
});
