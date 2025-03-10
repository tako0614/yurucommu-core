async function hashPassword(password: string): Promise<[string, string]> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const combined = new Uint8Array(passwordBuffer.length + salt.length);
  combined.set(passwordBuffer, 0);
  combined.set(salt, passwordBuffer.length);
  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  const saltArray = Array.from(new Uint8Array(salt));
  const saltHex = saltArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return [hashHex, saltHex];
}

async function verifyPassword(password: string, hash: string, salt: string) {
  const saltBytes = new Uint8Array(
    salt.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
  );
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const combined = new Uint8Array(passwordBuffer.length + saltBytes.length);
  combined.set(passwordBuffer);
  combined.set(saltBytes, passwordBuffer.length);
  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return hashHex === hash;
}

export { hashPassword, verifyPassword };
