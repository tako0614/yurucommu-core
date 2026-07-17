/**
 * Shared gateway-URL acceptance table.
 *
 * Consumed by BOTH the browser-push validator (this package) and the server's
 * notification pusher contract (backend), each in an equivalence test, so the
 * two independent copies of the URL policy cannot silently diverge into a
 * "client accepts / server rejects" mismatch.
 *
 * `valid` is whether the URL is an acceptable gateway. Bound-length-only cases
 * are omitted because only the server enforces the 2048-char cap.
 */
export interface GatewayUrlCase {
  readonly url: string;
  readonly valid: boolean;
  readonly note: string;
}

export const GATEWAY_URL_CASES: readonly GatewayUrlCase[] = [
  { url: "https://push.example/notify", valid: true, note: "public https" },
  {
    url: "https://push.example:443/notify",
    valid: true,
    note: "explicit 443 ok",
  },
  {
    url: "https://push.example:8443/notify",
    valid: false,
    note: "non-443 https port",
  },
  {
    url: "http://push.example/notify",
    valid: false,
    note: "plain http public",
  },
  {
    url: "http://localhost:8787/notify",
    valid: true,
    note: "loopback http ok",
  },
  { url: "http://127.0.0.1/notify", valid: true, note: "loopback ipv4 http" },
  {
    url: "https://user:pass@push.example/notify",
    valid: false,
    note: "credentials",
  },
  {
    url: "https://push.example/notify#frag",
    valid: false,
    note: "fragment",
  },
  {
    url: "https://192.168.0.1/notify",
    valid: false,
    note: "https ipv4 literal",
  },
  {
    url: "https://push.local/notify",
    valid: false,
    note: ".local suffix",
  },
  {
    url: "https://push.internal/notify",
    valid: false,
    note: ".internal suffix",
  },
  { url: "https://singlelabel/notify", valid: false, note: "no dot in host" },
  { url: "ftp://push.example/notify", valid: false, note: "wrong scheme" },
  { url: "not a url", valid: false, note: "unparseable" },
];
