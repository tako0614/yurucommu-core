// The response budget covers the complete encoded JSON, including metadata,
// punctuation and UTF-8/JSON escaping. Never send a partial successful archive.
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const EXPORT_READ_PAGE_SIZE = 25;

export function exportByteLimit(configured: string | undefined): number | null {
  if (configured === undefined) return MAX_EXPORT_BYTES;
  if (!/^[1-9][0-9]*$/.test(configured)) return null;
  const value = Number(configured);
  return Number.isSafeInteger(value) && value <= MAX_EXPORT_BYTES
    ? value
    : null;
}

export class ExportTooLarge extends Error {}

export class ExportJsonWriter {
  private readonly chunks: string[] = [];
  private readonly encoder = new TextEncoder();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(json: string): void {
    const bytes = this.encoder.encode(json).byteLength;
    if (bytes > this.maxBytes - this.bytes) throw new ExportTooLarge();
    this.bytes += bytes;
    this.chunks.push(json);
  }

  value(value: unknown): void {
    this.append(JSON.stringify(value));
  }

  finish(): string {
    return this.chunks.join("");
  }
}

export async function writeExportCollection<T>(
  writer: ExportJsonWriter,
  readPage: (limit: number, offset: number) => PromiseLike<T[]>,
  rowLimit: number,
  toItem: (row: T) => unknown,
  ordered = false,
): Promise<void> {
  writer.append(
    ordered ? '{"type":"OrderedCollection","ordered_items":[' : '{"items":[',
  );
  let total = 0;
  while (total < rowLimit) {
    const pageSize = Math.min(EXPORT_READ_PAGE_SIZE, rowLimit - total);
    const rows = await readPage(pageSize, total);
    for (const row of rows) {
      if (total > 0) writer.append(",");
      writer.value(toItem(row));
      total++;
    }
    if (rows.length < pageSize) break;
  }
  // Keep the original row-cap/truncated semantics, including exact-cap cases.
  writer.append(`],"total_items":${total},"truncated":${total >= rowLimit}}`);
}
