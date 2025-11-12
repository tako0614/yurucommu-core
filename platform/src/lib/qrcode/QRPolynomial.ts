import { QRMath } from "./QRMath";

export class QRPolynomial {
  private readonly num: number[];

  constructor(num: number[], shift: number) {
    if (num.length === undefined) {
      throw new Error(`${(num as any).length}/${shift}`);
    }

    let offset = 0;
    while (offset < num.length && num[offset] === 0) {
      offset += 1;
    }

    this.num = new Array<number>(num.length - offset + shift).fill(0);
    for (let i = 0; i < num.length - offset; i += 1) {
      this.num[i] = num[i + offset];
    }
  }

  get(index: number): number {
    return this.num[index];
  }

  getLength(): number {
    return this.num.length;
  }

  multiply(e: QRPolynomial): QRPolynomial {
    const num = new Array<number>(this.getLength() + e.getLength() - 1).fill(0);

    for (let i = 0; i < this.getLength(); i += 1) {
      for (let j = 0; j < e.getLength(); j += 1) {
        const value =
          QRMath.glog(this.get(i)) + QRMath.glog(e.get(j));
        num[i + j] ^= QRMath.gexp(value);
      }
    }

    return new QRPolynomial(num, 0);
  }

  mod(e: QRPolynomial): QRPolynomial {
    if (this.getLength() - e.getLength() < 0) {
      return this;
    }

    const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
    const num = new Array<number>(this.getLength()).fill(0);

    for (let i = 0; i < this.getLength(); i += 1) {
      num[i] = this.get(i);
    }

    for (let x = 0; x < e.getLength(); x += 1) {
      num[x] ^= QRMath.gexp(QRMath.glog(e.get(x)) + ratio);
    }

    return new QRPolynomial(num, 0).mod(e);
  }
}
