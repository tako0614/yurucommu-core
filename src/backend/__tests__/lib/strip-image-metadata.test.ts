import { expect, test } from "bun:test";

/**
 * Audit #16 #5 — uploaded raster images must have privacy metadata (EXIF GPS,
 * IPTC, XMP, PNG text chunks, WebP EXIF/XMP) stripped at ingest, without
 * touching the pixels.
 */

import { stripImageMetadata } from "../../lib/strip-image-metadata.ts";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const contains = (bytes: Uint8Array, s: string): boolean =>
  Buffer.from(bytes).includes(Buffer.from(s, "latin1"));

test("JPEG: APP1 EXIF (GPS) and COM are removed; JFIF + scan data are kept", () => {
  // SOI, APP1(Exif + a fake GPS marker), APP0(JFIF), COM(comment), SOS + entropy.
  const app1Payload = ascii("Exif\0\0SECRET-GPS-LOCATION");
  const app1Len = 2 + app1Payload.length;
  const jpeg = Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe1,
    (app1Len >> 8) & 0xff,
    app1Len & 0xff,
    ...app1Payload, // APP1
    0xff,
    0xe0,
    0x00,
    0x06,
    ...ascii("JFIF"), // APP0 (JFIF, kept)
    0xff,
    0xfe,
    0x00,
    0x0b,
    ...ascii("a-comment"), // COM len=2+9 (dropped)
    0xff,
    0xda,
    0x00,
    0x03,
    0x01,
    ...ascii("SCANDATA"), // SOS + entropy
    0xff,
    0xd9, // EOI
  ]);

  const out = stripImageMetadata(jpeg, "image/jpeg");
  expect(contains(out, "Exif")).toBe(false);
  expect(contains(out, "SECRET-GPS-LOCATION")).toBe(false);
  expect(contains(out, "a-comment")).toBe(false);
  // The actual image content (JFIF header + scan data) survives.
  expect(contains(out, "JFIF")).toBe(true);
  expect(contains(out, "SCANDATA")).toBe(true);
  // Still a valid JPEG (SOI preserved).
  expect(out[0]).toBe(0xff);
  expect(out[1]).toBe(0xd8);
  expect(out.length).toBeLessThan(jpeg.length);
});

test("PNG: tEXt / eXIf chunks are removed; IHDR + IDAT + IEND are kept", () => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]) => {
    const len = data.length;
    return [
      (len >> 24) & 0xff,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
      ...ascii(type),
      ...data,
      0x00,
      0x00,
      0x00,
      0x00, // dummy CRC (not validated)
    ];
  };
  const png = Uint8Array.from([
    ...sig,
    ...chunk("IHDR", ascii("HEADERBYTES!")),
    ...chunk("tEXt", ascii("Comment\0SECRET-TEXT")),
    ...chunk("eXIf", ascii("SECRET-EXIF")),
    ...chunk("IDAT", ascii("PIXELDATA")),
    ...chunk("IEND", []),
  ]);

  const out = stripImageMetadata(png, "image/png");
  expect(contains(out, "SECRET-TEXT")).toBe(false);
  expect(contains(out, "SECRET-EXIF")).toBe(false);
  expect(contains(out, "HEADERBYTES!")).toBe(true);
  expect(contains(out, "PIXELDATA")).toBe(true);
  expect(contains(out, "IEND")).toBe(true);
  // Signature preserved.
  for (let i = 0; i < 8; i++) expect(out[i]).toBe(sig[i]);
});

test("WebP: EXIF / XMP chunks are removed; VP8 image data is kept", () => {
  const riffChunk = (cc: string, data: number[]) => {
    const len = data.length;
    const padded = len & 1 ? [...data, 0x00] : data;
    return [
      ...ascii(cc),
      len & 0xff,
      (len >> 8) & 0xff,
      (len >> 16) & 0xff,
      (len >> 24) & 0xff,
      ...padded,
    ];
  };
  const body = [
    ...riffChunk("VP8 ", ascii("VP8-PIXELS")),
    ...riffChunk("EXIF", ascii("SECRET-WEBP-GPS")),
    ...riffChunk("XMP ", ascii("SECRET-XMP")),
  ];
  const riffSize = 4 + body.length;
  const webp = Uint8Array.from([
    ...ascii("RIFF"),
    riffSize & 0xff,
    (riffSize >> 8) & 0xff,
    (riffSize >> 16) & 0xff,
    (riffSize >> 24) & 0xff,
    ...ascii("WEBP"),
    ...body,
  ]);

  const out = stripImageMetadata(webp, "image/webp");
  expect(contains(out, "SECRET-WEBP-GPS")).toBe(false);
  expect(contains(out, "SECRET-XMP")).toBe(false);
  expect(contains(out, "VP8-PIXELS")).toBe(true);
  // RIFF/WEBP header preserved and size rewritten to match the kept body.
  expect(contains(out, "RIFF")).toBe(true);
  expect(contains(out, "WEBP")).toBe(true);
  const newSize = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
  expect(newSize).toBe(out.length - 8);
});

test("GIF and malformed input are passed through unchanged", () => {
  const gif = Uint8Array.from(ascii("GIF89a-some-bytes"));
  expect(stripImageMetadata(gif, "image/gif")).toBe(gif);
  // A "JPEG" that does not start with SOI is returned unchanged (never corrupt).
  const notJpeg = Uint8Array.from([0x00, 0x01, 0x02, 0x03]);
  expect(stripImageMetadata(notJpeg, "image/jpeg")).toBe(notJpeg);
});
