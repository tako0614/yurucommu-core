/**
 * QRCode for JavaScript (ported to TypeScript)
 *
 * Original work Copyright (c) 2009 Kazuhiko Arase
 * URL: http://www.d-project.com/
 * Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php
 *
 * The word "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
 */
import { QR8bitByte } from "./QR8bitByte";
import { QRUtil } from "./QRUtil";
import { QRPolynomial } from "./QRPolynomial";
import { QRRSBlock } from "./QRRSBlock";
import { QRBitBuffer } from "./QRBitBuffer";
import { QRErrorCorrectLevel, type QRErrorCorrectLevelValue } from "./QRErrorCorrectLevel";

export class QRCode {
  modules: (boolean | null)[][] = [];
  moduleCount = 0;
  dataCache: number[] | null = null;
  dataList: QR8bitByte[] = [];
  typeNumber: number;
  errorCorrectLevel: QRErrorCorrectLevelValue;

  constructor(typeNumber: number, errorCorrectLevel: QRErrorCorrectLevelValue) {
    this.typeNumber = typeNumber;
    this.errorCorrectLevel = errorCorrectLevel;
  }

  addData(data: string): void {
    const newData = new QR8bitByte(data);
    this.dataList.push(newData);
    this.dataCache = null;
  }

  isDark(row: number, col: number): boolean {
    if (row < 0 || row >= this.moduleCount || col < 0 || col >= this.moduleCount) {
      throw new Error(`${row},${col}`);
    }
    const modulesRow = this.modules[row];
    if (!modulesRow) {
      throw new Error(`Row ${row} is undefined`);
    }
    return Boolean(modulesRow[col]);
  }

  getModuleCount(): number {
    return this.moduleCount;
  }

  make(): void {
    if (this.typeNumber < 1) {
      let typeNumber = 1;
      for (; typeNumber < 40; typeNumber += 1) {
        const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);
        const buffer = new QRBitBuffer();
        let totalDataCount = 0;
        for (let i = 0; i < rsBlocks.length; i += 1) {
          totalDataCount += rsBlocks[i].dataCount;
        }
        for (let i = 0; i < this.dataList.length; i += 1) {
          const data = this.dataList[i];
          buffer.put(data.mode, 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
          data.write(buffer);
        }
        if (buffer.getLengthInBits() <= totalDataCount * 8) {
          break;
        }
      }
      this.typeNumber = Math.max(1, Math.min(typeNumber, 40));
    }
    this.makeImpl(false, this.getBestMaskPattern());
  }

  makeImpl(test: boolean, maskPattern: number): void {
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = new Array(this.moduleCount);

    for (let row = 0; row < this.moduleCount; row += 1) {
      this.modules[row] = new Array(this.moduleCount).fill(null);
    }

    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);

    if (this.typeNumber >= 7) {
      this.setupTypeNumber(test);
    }

    if (this.dataCache === null) {
      this.dataCache = QRCode.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
    }

    this.mapData(this.dataCache, maskPattern);
  }

  setupPositionProbePattern(row: number, col: number): void {
    for (let r = -1; r <= 7; r += 1) {
      const targetRow = row + r;
      if (targetRow <= -1 || targetRow >= this.moduleCount) continue;

      for (let c = -1; c <= 7; c += 1) {
        const targetCol = col + c;
        if (targetCol <= -1 || targetCol >= this.moduleCount) continue;

        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          this.modules[targetRow][targetCol] = true;
        } else {
          this.modules[targetRow][targetCol] = false;
        }
      }
    }
  }

  getBestMaskPattern(): number {
    let minLostPoint = 0;
    let pattern = 0;

    for (let i = 0; i < 8; i += 1) {
      this.makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(this);
      if (i === 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }

    return pattern;
  }

  setupTimingPattern(): void {
    for (let r = 8; r < this.moduleCount - 8; r += 1) {
      if (this.modules[r][6] !== null) {
        continue;
      }
      this.modules[r][6] = r % 2 === 0;
    }

    for (let c = 8; c < this.moduleCount - 8; c += 1) {
      if (this.modules[6][c] !== null) {
        continue;
      }
      this.modules[6][c] = c % 2 === 0;
    }
  }

  setupPositionAdjustPattern(): void {
    const pos = QRUtil.getPatternPosition(this.typeNumber);

    for (let i = 0; i < pos.length; i += 1) {
      for (let j = 0; j < pos.length; j += 1) {
        const row = pos[i];
        const col = pos[j];

        if (this.modules[row][col] !== null) {
          continue;
        }

        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            if (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) {
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  }

  setupTypeNumber(test: boolean): void {
    const bits = QRUtil.getBCHTypeNumber(this.typeNumber);

    for (let i = 0; i < 18; i += 1) {
      const mod = !test && ((bits >> i) & 1) === 1;
      this.modules[Math.floor(i / 3)][(i % 3) + this.moduleCount - 8 - 3] = mod;
    }

    for (let i = 0; i < 18; i += 1) {
      const mod = !test && ((bits >> i) & 1) === 1;
      this.modules[(i % 3) + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  }

  setupTypeInfo(test: boolean, maskPattern: number): void {
    const data = (this.errorCorrectLevel << 3) | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);

    for (let i = 0; i < 15; i += 1) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 6) {
        this.modules[i][8] = mod;
      } else if (i < 8) {
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }
    }

    for (let i = 0; i < 15; i += 1) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 8) {
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9) {
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }

    this.modules[this.moduleCount - 8][8] = !test;
  }

  mapData(data: number[], maskPattern: number): void {
    let inc = -1;
    let row = this.moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;

    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;

      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (this.modules[row][col - c] === null) {
            let dark = false;

            if (byteIndex < data.length) {
              dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            }

            const mask = QRUtil.getMask(maskPattern, row, col - c);
            if (mask) {
              dark = !dark;
            }

            this.modules[row][col - c] = dark;
            bitIndex -= 1;

            if (bitIndex === -1) {
              byteIndex += 1;
              bitIndex = 7;
            }
          }
        }

        row += inc;

        if (row < 0 || row >= this.moduleCount) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  static PAD0 = 0xEC;
  static PAD1 = 0x11;

  static createData(
    typeNumber: number,
    errorCorrectLevel: QRErrorCorrectLevelValue,
    dataList: QR8bitByte[],
  ): number[] {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
    const buffer = new QRBitBuffer();

    for (let i = 0; i < dataList.length; i += 1) {
      const data = dataList[i];
      buffer.put(data.mode, 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
      data.write(buffer);
    }

    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalDataCount += rsBlocks[i].dataCount;
    }

    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw new Error(
        `code length overflow. (${buffer.getLengthInBits()}>${totalDataCount * 8})`,
      );
    }

    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }

    while (buffer.getLengthInBits() % 8 !== 0) {
      buffer.putBit(false);
    }

    while (buffer.getLengthInBits() < totalDataCount * 8) {
      buffer.put(QRCode.PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(QRCode.PAD1, 8);
    }

    return QRCode.createBytes(buffer, rsBlocks);
  }

  static createBytes(buffer: QRBitBuffer, rsBlocks: QRRSBlock[]): number[] {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;

    const dcdata: number[][] = new Array(rsBlocks.length);
    const ecdata: number[][] = new Array(rsBlocks.length);

    for (let r = 0; r < rsBlocks.length; r += 1) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;

      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);

      dcdata[r] = new Array(dcCount).fill(0);
      for (let i = 0; i < dcdata[r].length; i += 1) {
        dcdata[r][i] = 0xff & buffer.buffer[i + offset];
      }
      offset += dcCount;

      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1).fill(0);
      for (let i = 0; i < ecdata[r].length; i += 1) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
      }
    }

    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalCodeCount += rsBlocks[i].totalCount;
    }

    const data = new Array<number>(totalCodeCount).fill(0);
    let index = 0;

    for (let i = 0; i < maxDcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < dcdata[r].length) {
          data[index] = dcdata[r][i];
          index += 1;
        }
      }
    }

    for (let i = 0; i < maxEcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < ecdata[r].length) {
          data[index] = ecdata[r][i];
          index += 1;
        }
      }
    }

    return data;
  }
}

export type GeneratedQRCode = {
  modules: boolean[][];
  moduleCount: number;
};

export function generateQrCode(
  text: string,
  errorCorrectionLevel: keyof typeof QRErrorCorrectLevel = "M",
): GeneratedQRCode {
  const level = QRErrorCorrectLevel[errorCorrectionLevel];
  const qr = new QRCode(-1, level);
  qr.addData(text);
  qr.make();
  const modules = qr.modules.map((row) => row.map((cell) => Boolean(cell)));
  return { modules, moduleCount: qr.getModuleCount() };
}
