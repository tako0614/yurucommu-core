import { sql, type GetColumnData, type SQLWrapper } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Database } from "../../db/index.ts";

// The response budget covers the complete encoded JSON, including metadata,
// punctuation and UTF-8/JSON escaping. Never send a partial successful archive.
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
// Bound round trips as well as response bytes. At the existing row caps this
// is <=32 collection reads plus the profile read, leaving room for auth on D1.
const MAX_EXPORT_PAGES_PER_COLLECTION = 8;

export function exportByteLimit(configured: string | undefined): number | null {
  if (configured === undefined) return MAX_EXPORT_BYTES;
  if (!/^[1-9][0-9]*$/.test(configured)) return null;
  const value = Number(configured);
  return Number.isSafeInteger(value) && value <= MAX_EXPORT_BYTES
    ? value
    : null;
}

export class ExportTooLarge extends Error {}
export class ExportInputTooLarge extends ExportTooLarge {}

// Separate from the encoded archive budget: stored JSON may contain whitespace
// that disappears during parsing. Share one input allowance across all pages.
export class ExportReadBudget {
  constructor(public remainingBytes: number) {}

  consume(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error("Invalid export input byte measurement");
    }
    if (bytes > this.remainingBytes) throw new ExportInputTooLarge();
    this.remainingBytes -= bytes;
  }
}

type ExportFields = Record<string, AnySQLiteColumn>;
type ExportRow<Fields extends ExportFields> = {
  [Key in keyof Fields]: GetColumnData<Fields[Key]>;
};

// Only the route's explicit, direct-column projections are accepted. Measure
// the original filtered/ordered/limited query and return its payload in ONE
// SQL snapshot. A separate preflight followed by an unconstrained read races
// concurrent writes. MATERIALIZED keeps cost evaluation inside the database;
// this bounds transfer/decoding, not database CPU or internal page storage.
export async function readExportPage<Fields extends ExportFields>(
  db: Database,
  budget: ExportReadBudget,
  fields: Fields,
  query: SQLWrapper,
  descendingKeys: readonly (keyof Fields & string)[] = [],
): Promise<ExportRow<Fields>[]> {
  const entries = Object.entries(fields);
  const column = (field: AnySQLiteColumn) =>
    sql`export_page.${sql.identifier(field.name)}`;
  const cost = sql.join(
    entries.map(
      ([, field]) => sql`coalesce(length(cast(${column(field)} as blob)), 0)`,
    ),
    sql` + `,
  );
  const payload = sql.join(
    entries.map(
      ([key, field]) => sql`${column(field)} as ${sql.identifier(key)}`,
    ),
    sql`, `,
  );
  const emptyPayload = sql.join(
    entries.map(([key]) => sql`null as ${sql.identifier(key)}`),
    sql`, `,
  );
  const order = descendingKeys.length
    ? sql`order by ${sql.join(
        descendingKeys.map((key) => sql`${sql.identifier(key)} desc`),
        sql`, `,
      )}`
    : sql``;
  const rows = await db.all<Record<string, unknown>>(sql`
    with export_page as materialized (${query.getSQL()}),
    export_budget as materialized (
      select coalesce(sum(${cost}), 0) as input_bytes,
             ${budget.remainingBytes} as max_bytes from export_page
    )
    select ${payload}, input_bytes as __export_input_bytes
    from export_page cross join export_budget where input_bytes <= max_bytes
    union all
    select ${emptyPayload}, input_bytes as __export_input_bytes
    from export_budget where input_bytes > max_bytes
    ${order}
  `);
  budget.consume(rows.length ? Number(rows[0].__export_input_bytes) : 0);
  // db.all is raw across both adapters. Preserve the original projection's
  // schema column decoders and SQL nulls, rather than returning raw values.
  return rows.map(
    (row) =>
      Object.fromEntries(
        entries.map(([key, field]) => [
          key,
          row[key] === null ? null : field.mapFromDriverValue(row[key]),
        ]),
      ) as ExportRow<Fields>,
  );
}

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
  const readPageSize = Math.ceil(rowLimit / MAX_EXPORT_PAGES_PER_COLLECTION);
  let total = 0;
  while (total < rowLimit) {
    const pageSize = Math.min(readPageSize, rowLimit - total);
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
