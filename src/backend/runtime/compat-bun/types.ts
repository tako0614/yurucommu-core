export type BunSQLiteRunResult = {
  changes: number;
  lastInsertRowid: number;
};

export interface BunSQLiteStatement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): BunSQLiteRunResult;
}

export interface BunSQLiteDatabase {
  exec(query: string): void;
  prepare(query: string): BunSQLiteStatement;
  transaction(callback: () => void): () => void;
}

export interface BunSQLiteDatabaseConstructor {
  new (filename: string): BunSQLiteDatabase;
}

export type BunFile = BodyInit & {
  readonly size: number;
  exists(): Promise<boolean>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
};

type BunWriteData =
  | Blob
  | string
  | ArrayBufferLike
  | ArrayBufferView<ArrayBufferLike>;

export interface BunRuntime {
  file(path: string): BunFile;
  write(path: string, data: BunWriteData): Promise<number>;
}

export function loadBunSqlite(
  runtimeRequire: (specifier: string) => unknown,
): BunSQLiteDatabaseConstructor {
  const sqliteModule = runtimeRequire("bun:sqlite") as {
    Database: BunSQLiteDatabaseConstructor;
  };
  return sqliteModule.Database;
}
