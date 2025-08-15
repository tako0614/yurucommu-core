export const GROUP_METADATA_EXTENSION_TYPE = 0xff01;

export interface GroupMetadata {
  name: string;
  icon?: string;
}

/**
 * GroupContext 拡張に name / icon を詰める
 */
export function encodeGroupMetadata(meta: GroupMetadata) {
  const data = new TextEncoder().encode(JSON.stringify(meta));
  return { extensionType: GROUP_METADATA_EXTENSION_TYPE, extensionData: data };
}

/**
 * GroupContext 拡張から name / icon を取り出す
 */
export function decodeGroupMetadata(
  exts: { extensionType: number; extensionData: Uint8Array }[],
): GroupMetadata | null {
  const found = exts.find((e) =>
    e.extensionType === GROUP_METADATA_EXTENSION_TYPE
  );
  if (!found) return null;
  try {
    return JSON.parse(new TextDecoder().decode(found.extensionData));
  } catch {
    return null;
  }
}
