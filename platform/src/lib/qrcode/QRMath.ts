export const QRMath = {
  glog(n: number): number {
    if (n < 1) {
      throw new Error(`glog(${n})`);
    }
    return QRMath.LOG_TABLE[n];
  },

  gexp(n: number): number {
    let value = n;
    while (value < 0) {
      value += 255;
    }
    while (value >= 256) {
      value -= 255;
    }
    return QRMath.EXP_TABLE[value];
  },

  EXP_TABLE: new Array<number>(256),
  LOG_TABLE: new Array<number>(256),
};

for (let i = 0; i < 8; i += 1) {
  QRMath.EXP_TABLE[i] = 1 << i;
}
for (let i = 8; i < 256; i += 1) {
  QRMath.EXP_TABLE[i] =
    QRMath.EXP_TABLE[i - 4] ^
    QRMath.EXP_TABLE[i - 5] ^
    QRMath.EXP_TABLE[i - 6] ^
    QRMath.EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i += 1) {
  QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;
}
