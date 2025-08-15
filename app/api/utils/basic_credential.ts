// KeyPackage から BasicCredential.identity を取り出す簡易パーサー
// ts-mls に依存せず最小限の TLS 解析のみを行う

function readUint16(view: DataView, pos: number): [number, number] {
  if (pos + 2 > view.byteLength) throw new Error("out of range");
  return [view.getUint16(pos, false), pos + 2];
}

function readOpaque(
  view: DataView,
  buf: Uint8Array,
  pos: number,
): [Uint8Array, number] {
  const [len, p] = readUint16(view, pos);
  if (p + len > view.byteLength) throw new Error("out of range");
  return [buf.subarray(p, p + len), p + len];
}

/**
 * KeyPackage バイナリから BasicCredential.identity を抽出する
 * @param kp キーパッケージのバイト列
 * @returns identity 文字列。解析できない場合は null
 */
export function extractBasicCredentialIdentity(kp: Uint8Array): string | null {
  try {
    const view = new DataView(kp.buffer, kp.byteOffset, kp.byteLength);
    let pos = 0;

    // KeyPackageHeader
    [, pos] = readUint16(view, pos); // version
    [, pos] = readUint16(view, pos); // cipher_suite
    [, pos] = readOpaque(view, kp, pos); // init_key

    // LeafNode
    [, pos] = readOpaque(view, kp, pos); // encryption_key
    [, pos] = readOpaque(view, kp, pos); // signature_key

    const [credType, p2] = readUint16(view, pos);
    pos = p2;
    if (credType !== 1) return null; // 1 = basic

    const [identity, p3] = readOpaque(view, kp, pos);
    pos = p3;
    return new TextDecoder().decode(identity);
  } catch {
    return null;
  }
}
