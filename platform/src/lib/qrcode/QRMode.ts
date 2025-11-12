export const QRMode = {
  MODE_NUMBER: 1,
  MODE_ALPHA_NUM: 2,
  MODE_8BIT_BYTE: 4,
  MODE_KANJI: 8,
} as const;

export type QRModeValue = (typeof QRMode)[keyof typeof QRMode];
