import { expect, test } from "bun:test";
import { normalizeBrowserPushGatewayUrl } from "./browser-push.ts";
import { GATEWAY_URL_CASES } from "./gateway-url-fixtures.ts";

test("browser-push gateway validator matches the shared acceptance table", () => {
  for (const { url, valid, note } of GATEWAY_URL_CASES) {
    const accepted = normalizeBrowserPushGatewayUrl(url) !== null;
    expect(accepted, `${note} (${url})`).toBe(valid);
  }
});
