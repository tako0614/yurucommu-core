import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  assertTrustedPublishingContext,
  npmPublishAuthenticationMode,
} from "./npm-publish-auth.mjs";

const commit = "a".repeat(40);
const tag = "v4.1.10";
const versions = { nodeVersion: "v24.0.0", npmVersion: "11.5.1", commit, tag };
const trusted = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "tako0614/yurucommu-core",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF:
    "tako0614/yurucommu-core/.github/workflows/npm-package-release.yml@refs/heads/main",
  GITHUB_JOB: "publish",
  RUNNER_ENVIRONMENT: "github-hosted",
  YURUCOMMU_NPM_RELEASE_ENVIRONMENT: "npm-release",
  YURUCOMMU_EXPECTED_RELEASE_SHA: commit,
  YURUCOMMU_EXPECTED_RELEASE_TAG: tag,
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/request",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "not-a-real-token",
};

describe("npm package publication authentication", () => {
  test("local execution retains the whoami preflight", () => {
    expect(npmPublishAuthenticationMode({}, undefined)).toBe("local-whoami");
  });

  test("only the exact manual GitHub-hosted release job may use native OIDC", () => {
    expect(assertTrustedPublishingContext(trusted, versions)).toBe(
      "trusted-oidc",
    );
    for (const [key, value] of [
      ["GITHUB_EVENT_NAME", "push"],
      ["GITHUB_REPOSITORY", "other/repository"],
      ["GITHUB_SERVER_URL", "https://github.example.com"],
      ["GITHUB_REF", "refs/tags/v4.1.10"],
      [
        "GITHUB_WORKFLOW_REF",
        "other/repository/.github/workflows/npm-package-release.yml@refs/heads/main",
      ],
      ["RUNNER_ENVIRONMENT", "self-hosted"],
      ["YURUCOMMU_NPM_RELEASE_ENVIRONMENT", "production"],
      ["YURUCOMMU_EXPECTED_RELEASE_SHA", "b".repeat(40)],
      ["YURUCOMMU_EXPECTED_RELEASE_TAG", "v4.1.11"],
    ] as const) {
      expect(() =>
        assertTrustedPublishingContext({ ...trusted, [key]: value }, versions),
      ).toThrow(key);
    }
  });

  test("arbitrary CI flags, missing OIDC permission, tokens, and old tools fail closed", () => {
    expect(() =>
      npmPublishAuthenticationMode({ GITHUB_ACTIONS: "true" }, versions),
    ).toThrow("GITHUB_EVENT_NAME");
    expect(() =>
      assertTrustedPublishingContext(
        { ...trusted, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" },
        versions,
      ),
    ).toThrow("id-token permission");
    expect(() =>
      assertTrustedPublishingContext(
        { ...trusted, NPM_TOKEN: "secret" },
        versions,
      ),
    ).toThrow("token-based");
    expect(() =>
      assertTrustedPublishingContext(
        { ...trusted, NPM_CONFIG_USERCONFIG: "/tmp/token-config" },
        versions,
      ),
    ).toThrow("token-based");
    expect(() =>
      assertTrustedPublishingContext(trusted, {
        ...versions,
        nodeVersion: "v22.13.9",
      }),
    ).toThrow("Node >=22.14.0");
    expect(() =>
      assertTrustedPublishingContext(trusted, {
        ...versions,
        npmVersion: "11.5.0",
      }),
    ).toThrow("npm >=11.5.1");
  });

  test("release workflow has no automatic trigger, cache, or raw npm publisher", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/npm-package-release.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^  (push|pull_request|release|schedule):/m);
    expect(workflow).toContain("environment: npm-release");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("ref: ${{ inputs.expected_sha }}");
    expect(workflow).toContain(
      "refs/tags/$YURUCOMMU_EXPECTED_RELEASE_TAG^{commit}",
    );
    expect(workflow).toContain(
      'test "$(git rev-parse HEAD)" = "$YURUCOMMU_EXPECTED_RELEASE_SHA"',
    );
    expect(workflow).toContain(
      'test "$(git rev-parse --verify "$GITHUB_SHA^{commit}")" = "$GITHUB_SHA"',
    );
    expect(workflow).toContain(
      'git merge-base --is-ancestor "$YURUCOMMU_EXPECTED_RELEASE_SHA" "$GITHUB_SHA"',
    );
    expect(workflow).not.toContain(
      'git merge-base --is-ancestor "$YURUCOMMU_EXPECTED_RELEASE_SHA" origin/main',
    );
    expect(
      workflow.indexOf(
        'git merge-base --is-ancestor "$YURUCOMMU_EXPECTED_RELEASE_SHA" "$GITHUB_SHA"',
      ),
    ).toBeLessThan(workflow.indexOf("bun install --frozen-lockfile"));
    expect(workflow).not.toContain("actions/cache@");
    expect(workflow).toContain("bun run deploy -- yurucommu-package-family");
    expect(workflow).not.toMatch(/run: npm publish/u);
  });
});
