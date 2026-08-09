import { expect, test } from "bun:test";

import {
  collectBoundedInboundAddresses,
  MAX_INBOUND_ADDRESS_ENTRIES,
  MAX_INBOUND_ADDRESS_LENGTH,
} from "../../../routes/activitypub/inbound-addressing.ts";

const address = (index: number) =>
  `https://remote.example/users/address-${index}`;

test("inbound addressing accepts the complete 64-entry boundary and rejects entry 65", () => {
  const boundary = Array.from(
    { length: MAX_INBOUND_ADDRESS_ENTRIES },
    (_, index) => address(index),
  );

  expect(collectBoundedInboundAddresses([{ to: boundary }])).toEqual({
    ok: true,
    addresses: boundary,
  });
  expect(
    collectBoundedInboundAddresses([{ to: [...boundary, address(64)] }]),
  ).toMatchObject({ ok: false, reason: "too_many" });
});

test("identical envelope/object field declarations count once but field placement remains significant", () => {
  const repeated = address(0);
  expect(
    collectBoundedInboundAddresses([
      { to: [repeated, repeated] },
      { to: [repeated] },
    ]),
  ).toEqual({ ok: true, addresses: [repeated] });

  const sixtyThree = Array.from({ length: 63 }, (_, index) => address(index));
  expect(
    collectBoundedInboundAddresses([
      { to: sixtyThree },
      { cc: [repeated, address(63)] },
    ]),
  ).toMatchObject({ ok: false, reason: "too_many" });
});

test("inbound addressing accepts 2048 characters and rejects 2049", () => {
  const prefix = "https://remote.example/users/";
  const atBoundary = `${prefix}${"x".repeat(
    MAX_INBOUND_ADDRESS_LENGTH - prefix.length,
  )}`;
  expect(atBoundary).toHaveLength(MAX_INBOUND_ADDRESS_LENGTH);
  expect(collectBoundedInboundAddresses([{ to: [atBoundary] }])).toEqual({
    ok: true,
    addresses: [atBoundary],
  });
  expect(
    collectBoundedInboundAddresses([{ to: [`${atBoundary}x`] }]),
  ).toMatchObject({ ok: false, reason: "too_long" });
});
