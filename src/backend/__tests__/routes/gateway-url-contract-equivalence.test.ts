import { expect, test } from "bun:test";

// The server's notification pusher contract and the independently-published
// browser-push validator each carry their own copy of the gateway-URL policy
// (the API package intentionally does not import backend source at runtime).
// This test pins the two copies to the SAME shared acceptance table so they
// cannot drift into a "client accepts / server rejects" mismatch.
import { normalizeGatewayUrl } from "../../lib/notification-pusher-contract.ts";
import { normalizeBrowserPushGatewayUrl } from "../../../../packages/api/src/lib/api/browser-push.ts";
import { GATEWAY_URL_CASES } from "../../../../packages/api/src/lib/api/gateway-url-fixtures.ts";

test("server + browser-push gateway validators agree with the shared table", () => {
  for (const { url, valid, note } of GATEWAY_URL_CASES) {
    const serverAccepts = normalizeGatewayUrl(url) !== null;
    const clientAccepts = normalizeBrowserPushGatewayUrl(url) !== null;
    expect(serverAccepts, `server: ${note} (${url})`).toBe(valid);
    expect(clientAccepts, `client: ${note} (${url})`).toBe(valid);
    expect(clientAccepts, `client/server drift: ${note} (${url})`).toBe(
      serverAccepts,
    );
  }
});
