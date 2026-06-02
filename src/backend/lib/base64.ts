/**
 * Base64 helpers shared by federation signing/verification paths.
 *
 * `bufferToBase64` walks the buffer in fixed-size chunks rather than spreading
 * the whole `Uint8Array` into `String.fromCharCode(...)`. The spread form
 * throws a "Maximum call stack size exceeded" RangeError once the buffer is
 * large enough (the spread becomes one argument per byte), so the chunked loop
 * is the stack-safe variant for arbitrary-size inputs.
 */
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (const byte of chunk) {
      binary += String.fromCharCode(byte);
    }
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
