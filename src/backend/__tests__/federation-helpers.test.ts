import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  assertSafeRemoteUrlResolved,
  isSafeRemoteUrl,
  type RemoteUrlSafetyOptions,
} from "../federation-helpers.ts";

function localResolver(
  ips: string[],
): NonNullable<RemoteUrlSafetyOptions["localResolver"]> {
  return async (_hostname, recordType) =>
    ips.filter((ip) =>
      recordType === "AAAA" ? ip.includes(":") : !ip.includes(":")
    );
}

function remoteResolver(
  ips: string[],
): NonNullable<RemoteUrlSafetyOptions["remoteResolver"]> {
  return async () => ips;
}

Deno.test("federation helpers - isSafeRemoteUrl rejects obvious local and malformed URLs", () => {
  const unsafe = [
    "http://localhost/inbox",
    "https://127.0.0.1/inbox",
    "https://10.0.0.2/inbox",
    "https://192.168.1.2/inbox",
    "https://user@example.com/inbox",
    "ftp://example.com/inbox",
    "https://service.local/inbox",
    "https://host.docker.internal/inbox",
  ];

  for (const url of unsafe) {
    assertEquals(isSafeRemoteUrl(url), false, url);
  }
  assertEquals(isSafeRemoteUrl("https://example.com/inbox"), true);
});

Deno.test("federation helpers - private resolved IPs stay blocked without the local-substrate flag", async () => {
  await assertRejects(
    () =>
      assertSafeRemoteUrlResolved("https://inst-b.takos.test/ap/users/tako", {
        remoteResolver: remoteResolver(["172.17.0.2"]),
      }),
    Error,
    "resolved to private IP",
  );
});

Deno.test("federation helpers - local-substrate flag allows only takos.test HTTPS actors on loopback or Docker bridge", async () => {
  for (
    const ip of ["127.0.0.1", "172.16.0.2", "172.17.0.2", "172.31.255.254"]
  ) {
    await assertSafeRemoteUrlResolved(
      "https://inst-b.takos.test/ap/users/tako",
      {
        allowLocalSubstrateRemoteFetches: true,
        localResolver: localResolver([ip]),
      },
    );
  }
});

Deno.test("federation helpers - local-substrate flag rejects private ranges outside the allowlist", async () => {
  for (
    const ip of [
      "10.0.0.2",
      "192.168.1.2",
      "169.254.1.1",
      "172.15.255.255",
      "172.32.0.1",
      "::1",
      "fc00::1",
      "8.8.8.8",
    ]
  ) {
    await assertRejects(
      () =>
        assertSafeRemoteUrlResolved("https://inst-b.takos.test/ap/users/tako", {
          allowLocalSubstrateRemoteFetches: true,
          localResolver: localResolver([ip]),
        }),
      Error,
      "outside local-substrate allowlist",
      ip,
    );
  }
});

Deno.test("federation helpers - local-substrate flag rejects non-local-substrate URL shapes", async () => {
  const localOptions: RemoteUrlSafetyOptions = {
    allowLocalSubstrateRemoteFetches: true,
    localResolver: localResolver(["127.0.0.1"]),
    remoteResolver: remoteResolver(["127.0.0.1"]),
  };

  await assertRejects(
    () =>
      assertSafeRemoteUrlResolved(
        "http://inst-b.takos.test/ap/users/tako",
        localOptions,
      ),
    Error,
    "Unsafe local-substrate remote URL",
  );
  await assertRejects(
    () =>
      assertSafeRemoteUrlResolved(
        "https://inst-b.takos.test:8791/ap/users/tako",
        localOptions,
      ),
    Error,
    "Unsafe local-substrate remote URL",
  );
  await assertRejects(
    () =>
      assertSafeRemoteUrlResolved(
        "https://evil.test/ap/users/tako",
        localOptions,
      ),
    Error,
    "resolved to private IP",
  );
  await assertRejects(
    () =>
      assertSafeRemoteUrlResolved(
        "https://host.docker.internal/ap/users/tako",
        localOptions,
      ),
    Error,
    "Unsafe remote URL",
  );
});
