/**
 * Strip privacy-sensitive metadata from an uploaded raster image at ingest.
 *
 * Phone cameras embed EXIF GPS coordinates, capture timestamps and camera serial
 * numbers in uploaded JPEGs (and, less commonly, PNG/WebP). yurucommu serves
 * uploaded media verbatim under a 1-year public cache, so a public post or
 * profile image would otherwise leak the poster's location — a recognised
 * fediverse-class privacy defect (Mastodon strips image metadata server-side for
 * exactly this reason). This module removes the metadata segments WITHOUT
 * re-encoding the pixels, so the visible image is unchanged.
 *
 * Pure byte-surgery (no native image library): it walks the container structure
 * and drops only metadata segments/chunks, copying everything else verbatim. It
 * NEVER corrupts: on any structural surprise it returns the original bytes
 * unchanged (the magic-byte validation has already confirmed the declared type).
 *
 * Covered: JPEG (APP1 EXIF/XMP, APP13 IPTC, COM), PNG (tEXt/zTXt/iTXt/eXIf/tIME),
 * WebP (EXIF / XMP chunks). GIF and video are passed through unchanged (GIF
 * rarely carries geotags; video metadata stripping needs a transcode pipeline).
 */

/** Strip metadata for a supported raster image; pass other types through. */
export function stripImageMetadata(
  bytes: Uint8Array,
  mimeType: string,
): Uint8Array {
  try {
    switch (mimeType) {
      case "image/jpeg":
        return stripJpeg(bytes);
      case "image/png":
        return stripPng(bytes);
      case "image/webp":
        return stripWebp(bytes);
      default:
        return bytes; // gif / video / unknown: unchanged
    }
  } catch {
    // Never let a parsing surprise corrupt or drop the upload.
    return bytes;
  }
}

// ---------------------------------------------------------------------------
// JPEG: a stream of marker segments. Drop APP1 (EXIF + XMP), APP13 (IPTC /
// Photoshop) and COM (comment); keep APP0 (JFIF), APP2 (ICC), APP14 (Adobe
// color transform), the quantization/Huffman tables, and the scan data verbatim.
// ---------------------------------------------------------------------------
function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  const out: number[] = [0xff, 0xd8]; // SOI
  let i = 2;

  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return bytes; // not at a marker — bail unchanged
    const marker = bytes[i + 1];

    // Start of Scan: entropy-coded data runs to EOI — copy the rest verbatim.
    if (marker === 0xda) {
      for (let k = i; k < bytes.length; k++) out.push(bytes[k]);
      return Uint8Array.from(out);
    }
    // Standalone markers carry no length payload.
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    if (i + 3 >= bytes.length) return bytes; // truncated length — bail unchanged
    const len = (bytes[i + 2] << 8) | bytes[i + 3]; // includes the 2 length bytes
    if (len < 2 || i + 2 + len > bytes.length) return bytes; // malformed — bail

    const drop =
      marker === 0xe1 || // APP1: EXIF + XMP (the GPS carriers)
      marker === 0xed || // APP13: IPTC / Photoshop
      marker === 0xfe; // COM: comment
    if (!drop) {
      for (let k = i; k < i + 2 + len; k++) out.push(bytes[k]);
    }
    i += 2 + len;
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// PNG: an 8-byte signature followed by length-prefixed chunks. Drop the textual
// / metadata ancillary chunks; keep critical + rendering-relevant chunks.
// ---------------------------------------------------------------------------
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function stripPng(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8) return bytes;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return bytes;

  const out: number[] = [...PNG_SIGNATURE];
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len =
      (bytes[i] << 24) |
      (bytes[i + 1] << 16) |
      (bytes[i + 2] << 8) |
      bytes[i + 3];
    if (len < 0) return bytes; // overflow / malformed — bail unchanged
    const type = String.fromCharCode(
      bytes[i + 4],
      bytes[i + 5],
      bytes[i + 6],
      bytes[i + 7],
    );
    const chunkEnd = i + 12 + len; // length(4) + type(4) + data(len) + crc(4)
    if (chunkEnd > bytes.length) return bytes; // truncated — bail unchanged

    if (!PNG_DROP_CHUNKS.has(type)) {
      for (let k = i; k < chunkEnd; k++) out.push(bytes[k]);
    }
    i = chunkEnd;
    if (type === "IEND") break;
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// WebP: a RIFF container ("RIFF" <size> "WEBP" <chunks>). Drop the "EXIF" and
// "XMP " chunks, clear the matching VP8X feature-flag bits, and rewrite the RIFF
// size. Chunks are FourCC(4) + size(4, little-endian) + payload + 1 pad byte to
// an even length.
// ---------------------------------------------------------------------------
function fourCC(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(
    bytes[off],
    bytes[off + 1],
    bytes[off + 2],
    bytes[off + 3],
  );
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 16) return bytes;
  if (fourCC(bytes, 0) !== "RIFF" || fourCC(bytes, 8) !== "WEBP") return bytes;

  const head: number[] = [];
  for (let k = 0; k < 12; k++) head.push(bytes[k]); // RIFF + size + WEBP
  const body: number[] = [];
  let removed = false;

  let i = 12;
  while (i + 8 <= bytes.length) {
    const cc = fourCC(bytes, i);
    const size =
      bytes[i + 4] |
      (bytes[i + 5] << 8) |
      (bytes[i + 6] << 16) |
      (bytes[i + 7] << 24);
    if (size < 0) return bytes; // overflow — bail unchanged
    const padded = size + (size & 1); // chunks pad to an even length
    const chunkEnd = i + 8 + padded;
    if (chunkEnd > bytes.length) return bytes; // truncated — bail unchanged

    if (cc === "EXIF" || cc === "XMP ") {
      removed = true; // skip this chunk entirely
    } else {
      for (let k = i; k < chunkEnd; k++) body.push(bytes[k]);
    }
    i = chunkEnd;
  }
  if (!removed) return bytes; // nothing to strip — keep original bytes

  // Clear the EXIF (bit 3) / XMP (bit 2) feature flags in a VP8X header so the
  // declared features match the chunks that remain. VP8X payload byte 0 holds
  // the flags; it sits at body offset 8 when VP8X is the first chunk.
  if (body.length >= 9 && fourCC(Uint8Array.from(body), 0) === "VP8X") {
    body[8] &= ~0b00001100;
  }

  // Rewrite the RIFF chunk size = bytes after the 8-byte RIFF header = "WEBP"
  // (4) + body.
  const riffSize = 4 + body.length;
  head[4] = riffSize & 0xff;
  head[5] = (riffSize >> 8) & 0xff;
  head[6] = (riffSize >> 16) & 0xff;
  head[7] = (riffSize >> 24) & 0xff;

  return Uint8Array.from([...head, ...body]);
}
