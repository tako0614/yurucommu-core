import { expect, test } from "bun:test";

import { base64ToBytes, bufferToBase64 } from "../../lib/base64.ts";

test("bufferToBase64 / base64ToBytes round-trip small buffers", () => {
  const bytes = new Uint8Array([0, 1, 2, 254, 255, 65, 66, 67]);
  const encoded = bufferToBase64(bytes.buffer);
  // Cross-check against the platform's own base64 of the same string.
  expect(encoded).toEqual(btoa("\x00\x01\x02\xfe\xffABC"));
  expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(bytes));
});

test("bufferToBase64 round-trips a >8KB buffer (past the 8192-byte chunk boundary)", () => {
  // The previous spread implementation (String.fromCharCode(...bytes)) throws a
  // RangeError once the buffer is large enough; the chunked loop must encode
  // arbitrary-size buffers without overflowing the call stack.
  const size = 8192 * 3 + 123; // spans multiple chunks, not a multiple of 8192
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 256;

  const encoded = bufferToBase64(bytes.buffer);
  const decoded = base64ToBytes(encoded);

  expect(decoded.length).toEqual(size);
  for (let i = 0; i < size; i++) {
    expect(decoded[i]).toEqual(i % 256);
  }
});

test("bufferToBase64 handles an empty buffer", () => {
  expect(bufferToBase64(new Uint8Array(0).buffer)).toEqual("");
  expect(base64ToBytes("").length).toEqual(0);
});
