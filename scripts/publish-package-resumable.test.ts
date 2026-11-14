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

  test("publisher reconciliation marks a failed npm invocation as touched when the registry read fails", async () => {
    const reconciliationError = new Error("registry reconciliation timeout");
    let reads = 0;
    let verifications = 0;
    const commands: { command: string; args: string[] }[] = [];
    const failure = await publishPreparedPackage(
      {
        packageName: "@takosjp/example",
        version: "3.4.5",
        integrity: "sha512-local",
        tarballPath: "/tmp/example.tgz",
        packageRoot: process.cwd(),
      },
      {
        publishedPackageIntegrity: async () => {
          reads += 1;
          if (reads === 1) return undefined;
          throw reconciliationError;
        },
        runCommand: (command, args) => {
          commands.push({ command, args });
          return { status: 1, stdout: "", stderr: "npm connection lost" };
        },
        verifyPublishedIntegrity: async () => {
          verifications += 1;
        },
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(reads).toBe(2);
    expect(commands).toEqual([
      {
        command: "npm",
        args: [
          "publish",
          "/tmp/example.tgz",
          "--access",
          "public",
          "--ignore-scripts",
        ],
      },
    ]);
    expect(verifications).toBe(0);
    expect(failure).toMatchObject({
      name: "PublishMutationError",
      targetTouched: true,
      cause: reconciliationError,
    });
  });

  test("publisher reconciliation keeps pre-mutation rejection and exact skips untouched", async () => {
    const candidate = {
      packageName: "@takosjp/example",
      version: "3.4.5",
      integrity: "sha512-local",
      tarballPath: "/tmp/example.tgz",
      packageRoot: process.cwd(),
    };
    const readError = new Error("initial registry read failed");
    let mutations = 0;
    let verifications = 0;
    const commands = {
      runCommand: () => {
        mutations += 1;
        return { status: 0, stdout: "published", stderr: "" };
      },
      verifyPublishedIntegrity: async () => {
        verifications += 1;
      },
    };
    const failure = await publishPreparedPackage(candidate, {
      ...commands,
      publishedPackageIntegrity: async () => {
        throw readError;
      },
    }).catch((error: unknown) => error);
    expect(failure).toBe(readError);
    expect(failure).not.toHaveProperty("targetTouched");

    await expect(
      publishPreparedPackage(candidate, {
        ...commands,
        publishedPackageIntegrity: async () => "sha512-other",
      }),
    ).rejects.toThrow("does not match local tarball integrity");
    expect(
      await publishPreparedPackage(candidate, {
        ...commands,
        publishedPackageIntegrity: async () => "sha512-local",
      }),
    ).toEqual({ action: "skipped", integrity: "sha512-local" });
    expect(mutations).toBe(0);
    expect(verifications).toBe(0);
  });

  test("publisher reconciliation accepts only exact raced bytes after a failed invocation", async () => {
    for (const racedIntegrity of [undefined, "sha512-other", "sha512-local"]) {
      let reads = 0;
      let mutations = 0;
      let verifications = 0;
      const result = await publishPreparedPackage(
        {
          packageName: "@takosjp/example",
          version: "3.4.5",
          integrity: "sha512-local",
          tarballPath: "/tmp/example.tgz",
          packageRoot: process.cwd(),
        },
        {
          publishedPackageIntegrity: async () => {
            reads += 1;
            return reads === 1 ? undefined : racedIntegrity;
          },
          runCommand: () => {
            mutations += 1;
            return { status: 1, stdout: "", stderr: "npm rejected" };
          },
          verifyPublishedIntegrity: async () => {
            verifications += 1;
          },
        },
      ).catch((error: unknown) => error);
      if (racedIntegrity === "sha512-local") {
        expect(result).toEqual({
          action: "concurrent-exact",
          integrity: "sha512-local",
        });
      } else {
        expect(result).toMatchObject({
          name: "PublishMutationError",
          targetTouched: true,
        });
      }
      expect(reads).toBe(2);
      expect(mutations).toBe(1);
      expect(verifications).toBe(0);
    }
  });

  test("publisher reconciliation preserves a completed package across an explicit pair resume", async () => {
    const core = {
      packageName: "@takosjp/example-core",
      version: "3.4.5",
      integrity: "sha512-core",
      tarballPath: "/tmp/example-core.tgz",
      packageRoot: process.cwd(),
    };
    const api = {
      ...core,
      packageName: "@takosjp/example-api",
      integrity: "sha512-api",
      tarballPath: "/tmp/example-api.tgz",
    };
    const registry = new Map<string, string>();
    const mutations: string[] = [];
    const verifications: string[] = [];
    const readError = new Error("second package reconciliation unavailable");
    let firstAttempt = true;
    let apiReads = 0;
    const dependencies = {
      publishedPackageIntegrity: async (name: string) => {
        if (name === api.packageName && firstAttempt) {
          apiReads += 1;
          if (apiReads === 2) throw readError;
        }
        return registry.get(name);
      },
      runCommand: (_command: string, args: string[]) => {
        mutations.push(args[1]);
        const candidate = args[1] === core.tarballPath ? core : api;
        if (candidate === api && firstAttempt) {
          return { status: 1, stdout: "", stderr: "npm response lost" };
        }
        registry.set(candidate.packageName, candidate.integrity);
        return { status: 0, stdout: "published", stderr: "" };
      },
      verifyPublishedIntegrity: async (
        name: string,
        _version: string,
        integrity: string,
      ) => {
        expect(registry.get(name)).toBe(integrity);
        verifications.push(name);
      },
    };
    expect(await publishPreparedPackage(core, dependencies)).toEqual({
      action: "published",
      integrity: core.integrity,
    });
    await expect(
      publishPreparedPackage(api, dependencies),
    ).rejects.toMatchObject({
      name: "PublishMutationError",
      targetTouched: true,
      cause: readError,
    });
    expect(mutations).toEqual([core.tarballPath, api.tarballPath]);
    expect(verifications).toEqual([core.packageName]);

    // This is an explicit caller resume; the helper did not retry the failure.
    firstAttempt = false;
    expect(await publishPreparedPackage(core, dependencies)).toEqual({
      action: "skipped",
      integrity: core.integrity,
    });
    expect(await publishPreparedPackage(api, dependencies)).toEqual({
      action: "published",
      integrity: api.integrity,
    });
    expect(mutations).toEqual([
      core.tarballPath,
      api.tarballPath,
      api.tarballPath,
    ]);
    expect(verifications).toEqual([core.packageName, api.packageName]);
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
