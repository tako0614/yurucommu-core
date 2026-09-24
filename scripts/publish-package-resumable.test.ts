import { describe, expect, test } from "bun:test";

import {
  packageReleaseDecision,
  publishPreparedPackage,
  publishedPackageIntegrity,
  verifyPublishedIntegrity,
} from "./publish-package-resumable.mjs";

describe("resumable package release", () => {
  test("publishes an absent version and skips only an exact existing tarball", () => {
    expect(packageReleaseDecision("sha512-local", undefined)).toBe("publish");
    expect(packageReleaseDecision("sha512-local", "sha512-local")).toBe("skip");
  });

  test("rejects an existing version with different immutable contents", () => {
    expect(() =>
      packageReleaseDecision("sha512-local", "sha512-published"),
    ).toThrow("does not match local tarball integrity");
  });

  test("marks a successful npm mutation as touched when readback fails", async () => {
    const calls: string[][] = [];
    await expect(
      publishPreparedPackage(
        {
          packageName: "@takosjp/example",
          version: "3.4.5",
          integrity: "sha512-local",
          tarballPath: "/tmp/example.tgz",
          packageRoot: process.cwd(),
        },
        {
          publishedPackageIntegrity: async () => undefined,
          runCommand: (_command, args) => {
            calls.push(args);
            return { status: 0, stdout: "published", stderr: "" };
          },
          verifyPublishedIntegrity: async () => {
            throw new Error("registry readback timeout");
          },
        },
      ),
    ).rejects.toMatchObject({
      name: "PublishMutationError",
      targetTouched: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("publish");
  });

  test("waits through delayed 404 reads until the exact integrity appears", async () => {
    let now = 0;
    const delays: number[] = [];
    const reads: (string | undefined)[] = [
      undefined,
      undefined,
      "sha512-local",
    ];

    await verifyPublishedIntegrity(
      "@takosjp/example",
      "3.4.5",
      "sha512-local",
      {
        maxWaitMs: 5_000,
        pollIntervalMs: 1_000,
        readTimeoutMs: 100,
        now: () => now,
        sleep: async (delayMs) => {
          delays.push(delayMs);
          now += delayMs;
        },
        readIntegrity: async (_packageName, _version, readOptions) => {
          expect(readOptions.timeoutMs).toBe(100);
          return reads.shift();
        },
        onProgress: () => {},
      },
    );

    expect(delays).toEqual([1_000, 1_000]);
    expect(reads).toHaveLength(0);
  });

  test("fails immediately when a readback integrity mismatches", async () => {
    let reads = 0;
    let sleeps = 0;

    await expect(
      verifyPublishedIntegrity("@takosjp/example", "3.4.5", "sha512-local", {
        maxWaitMs: 5_000,
        pollIntervalMs: 1_000,
        now: () => 0,
        sleep: async () => {
          sleeps += 1;
        },
        readIntegrity: async () => {
          reads += 1;
          return "sha512-other";
        },
        onProgress: () => {},
      }),
    ).rejects.toThrow("does not match local tarball integrity");

    expect(reads).toBe(1);
    expect(sleeps).toBe(0);
  });

  test("bounds each npm metadata fetch with an abort timeout", async () => {
    let signal: AbortSignal | undefined;
    await expect(
      publishedPackageIntegrity("@takosjp/example", "3.4.5", {
        timeoutMs: 5,
        fetchImpl: async (_url, options) =>
          new Promise((_resolve, reject) => {
            signal = options.signal;
            options.signal.addEventListener("abort", () =>
              reject(new Error("fetch aborted")),
            );
          }),
      }),
    ).rejects.toThrow("Timed out reading npm release metadata");
    expect(signal?.aborted).toBe(true);
  });

  test("keeps one npm mutation and marks the target touched at the deadline", async () => {
    let now = 0;
    let reads = 0;
    let mutations = 0;

    await expect(
      publishPreparedPackage(
        {
          packageName: "@takosjp/example",
          version: "3.4.5",
          integrity: "sha512-local",
          tarballPath: "/tmp/example.tgz",
          packageRoot: process.cwd(),
        },
        {
          publishedPackageIntegrity: async () => undefined,
          runCommand: (_command, args) => {
            mutations += 1;
            expect(args).toContain("publish");
            return { status: 0, stdout: "published", stderr: "" };
          },
          verifyPublishedIntegrity: (...args) =>
            verifyPublishedIntegrity(...args, {
              maxWaitMs: 2_000,
              pollIntervalMs: 1_000,
              readTimeoutMs: 100,
              now: () => now,
              sleep: async (delayMs) => {
                now += delayMs;
              },
              readIntegrity: async () => {
                reads += 1;
                return undefined;
              },
              onProgress: () => {},
            }),
        },
      ),
    ).rejects.toMatchObject({
      name: "PublishMutationError",
      targetTouched: true,
    });

    expect(mutations).toBe(1);
    expect(reads).toBe(2);
  });
});
