import { expect, test } from "bun:test";

import { isPrivateIpAddress, isWellFormedIp } from "../../lib/ssrf.ts";

// Audit #9 finding #2: the resolved-IP SSRF gate (assertSafeRemoteUrlResolved →
// isPrivateIpAddress) only caught the DOTTED IPv4-mapped form (::ffff:127.0.0.1)
// and a small prefix list. An attacker controlling authoritative DNS for an
// otherwise-public hostname could serve an AAAA record in a non-canonical
// encoding of a loopback/private IPv4 — hex-mapped, IPv4-compatible, NAT64,
// 6to4, or expanded — and slip past the private-IP classifier. The classifier
// now fully expands the address and decodes the embedded IPv4.

const PRIVATE_FORMS = [
  // every non-canonical encoding of 127.0.0.1 / 10.0.0.1 / 192.168.0.1 / 172.16.0.1
  "::ffff:7f00:1", // IPv4-mapped, hex
  "::ffff:127.0.0.1", // IPv4-mapped, dotted (already caught before)
  "0:0:0:0:0:ffff:7f00:1", // IPv4-mapped, fully expanded
  "::127.0.0.1", // IPv4-compatible (deprecated)
  "::7f00:1", // IPv4-compatible, hex
  "64:ff9b::7f00:1", // NAT64 well-known prefix
  "64:ff9b::a00:1", // NAT64 → 10.0.0.1
  "2002:7f00:1::", // 6to4 → 127.0.0.1
  "2002:0a00:0001::", // 6to4 → 10.0.0.1
  "::ffff:c0a8:1", // 192.168.0.1
  "::ffff:ac10:1", // 172.16.0.1
  // native private/reserved ranges
  "::1",
  "fc00::1",
  "fd12:3456::1",
  "fe80::1",
  "fec0::1",
  "ff02::1",
];

const PUBLIC_FORMS = [
  "2606:4700:4700::1111", // Cloudflare DNS
  "2404:6800:4003::200e", // Google
  "2001:db8::1", // documentation range (not private-classified)
  "::ffff:808:808", // IPv4-mapped 8.8.8.8 (public)
  "::ffff:1.1.1.1", // IPv4-mapped 1.1.1.1 (public)
  "2002:0808:0808::", // 6to4 wrapping public 8.8.8.8
  "64:ff9b::808:808", // NAT64 wrapping public 8.8.8.8
];

test("isPrivateIpAddress blocks every non-canonical encoding of a loopback/private IPv4", () => {
  for (const ip of PRIVATE_FORMS) {
    expect({ ip, private: isPrivateIpAddress(ip) }).toEqual({
      ip,
      private: true,
    });
  }
});

test("isPrivateIpAddress does NOT over-block public IPv6 (incl. transition forms wrapping public IPv4)", () => {
  for (const ip of PUBLIC_FORMS) {
    expect({ ip, private: isPrivateIpAddress(ip) }).toEqual({
      ip,
      private: false,
    });
  }
});

test("isWellFormedIp rejects unparseable RDATA (fail-closed) and accepts real literals", () => {
  expect(isWellFormedIp("not-an-ip")).toBe(false);
  expect(isWellFormedIp("0:0:0:0:0:0:ffff:7f00:1")).toBe(false); // 9 groups
  expect(isWellFormedIp("12345::1")).toBe(false); // hextet > 4 hex digits
  expect(isWellFormedIp("1.2.3.4")).toBe(true);
  expect(isWellFormedIp("::ffff:7f00:1")).toBe(true);
  expect(isWellFormedIp("2606:4700::1111")).toBe(true);
});
