import { QRMode } from "./QRMode";
import { QRBitBuffer } from "./QRBitBuffer";

export class QR8bitByte {
  readonly mode = QRMode.MODE_8BIT_BYTE;
  private readonly data: string;

  constructor(data: string) {
    this.data = data;
  }

  getLength(): number {
    return this.data.length;
  }

  write(buffer: QRBitBuffer): void {
    for (let i = 0; i < this.data.length; i += 1) {
      buffer.put(this.data.charCodeAt(i), 8);
    }
  }
}
