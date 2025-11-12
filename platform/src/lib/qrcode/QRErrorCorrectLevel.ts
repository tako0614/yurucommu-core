export const QRErrorCorrectLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2,
} as const;

export type QRErrorCorrectLevelValue = (typeof QRErrorCorrectLevel)[keyof typeof QRErrorCorrectLevel];
