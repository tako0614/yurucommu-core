/// <reference types="@cloudflare/workers-types" />

import type { AppCollectionDefinition, AppCollectionIndexDefinition } from "./types";

type PrimitiveValue = string | number | boolean | null;

export type WhereValue =
  | PrimitiveValue
  | {
      in?: PrimitiveValue[];
      notIn?: PrimitiveValue[];
      gt?: PrimitiveValue;
      gte?: PrimitiveValue;
      lt?: PrimitiveValue;
      lte?: PrimitiveValue;
      not?: PrimitiveValue;
    };

export type WhereClause = Record<string, WhereValue>;

export type SortDirection = "asc" | "desc";

type NormalizedColumn = {
  name: string;
  sql: string;
  hasInlinePrimaryKey: boolean;
};

type NormalizedIndex = {
  name: string;
  columns: string[];
  unique: boolean;
  where?: string;
};

type NormalizedCollection = {
  name: string;
  engine: "sqlite";
  columns: Record<string, NormalizedColumn>;
  primaryKey?: string[];
  indexes: NormalizedIndex[];
};

type WorkspaceId = string | null | undefined;

export interface AppDataAdapterOptions {
  tableNamePrefix?: string;
  workspaceTablePrefix?: string | ((workspaceId: string) => string | null | undefined);
  resolveDatabase?: (workspaceId?: WorkspaceId) => D1Database | null | undefined;
}

export interface CollectionQuery {
  orderBy(column: string, direction?: SortDirection): CollectionQuery;
  limit(max: number): CollectionQuery;
  offset(skip: number): CollectionQuery;
  all(): Promise<any[]>;
  first(): Promise<any | null>;
}

export class AppCollectionQuery implements CollectionQuery {
  constructor(
    private readonly runSelect: (
      where: WhereClause | undefined,
      order: Array<{ column: string; direction: SortDirection }>,
      limit?: number,
      offset?: number,
    ) => Promise<any[]>,
    private readonly where?: WhereClause,
  ) {}

  private sorts: Array<{ column: string; direction: SortDirection }> = [];
  private take?: number;
  private skip?: number;

  orderBy(column: string, direction: SortDirection = "asc"): CollectionQuery {
    this.sorts.push({ column, direction });
    return this;
  }

  limit(max: number): CollectionQuery {
    this.take = max;
    return this;
  }

  offset(skip: number): CollectionQuery {
    this.skip = skip;
    return this;
  }

  async all(): Promise<any[]> {
    return this.runSelect(this.where, this.sorts, this.take, this.skip);
  }

  async first(): Promise<any | null> {
    const rows = await this.runSelect(this.where, this.sorts, this.take ?? 1, this.skip);
    return rows.length > 0 ? rows[0] : null;
  }
}

export class AppCollectionDao {
  private readonly tableName: string;
  private readonly quotedTableName: string;
  private readonly columns: Record<string, NormalizedColumn>;
  private readonly indexes: NormalizedIndex[];
  private readonly primaryKey?: string[];
  private schemaReady: Promise<void> | null = null;

  constructor(
    private readonly db: D1Database,
    private readonly collection: NormalizedCollection,
    tableName: string,
  ) {
    if (!db) {
      throw new Error("D1 database instance is required");
    }
    this.tableName = tableName;
    this.quotedTableName = quoteIdentifier(tableName);
    this.columns = collection.columns;
    this.indexes = collection.indexes;
    this.primaryKey = collection.primaryKey;
  }

  find(where?: WhereClause): CollectionQuery {
    return new AppCollectionQuery((w, order, limit, offset) => this.select(w, order, limit, offset), where);
  }

  async insert(record: Record<string, unknown>): Promise<any> {
    await this.ensureSchema();
    const entries = Object.entries(record ?? {});
    if (entries.length === 0) {
      throw new Error("Cannot insert an empty record");
    }

    const columns: string[] = [];
    const placeholders: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of entries) {
      validateColumnExists(key, this.columns);
      columns.push(quoteIdentifier(key));
      placeholders.push("?");
      values.push(value);
    }

    const sql = `INSERT INTO ${this.quotedTableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
    return this.db.prepare(sql).bind(...values).run();
  }

  async update(where: WhereClause, changes: Record<string, unknown>): Promise<any> {
    await this.ensureSchema();
    const changeEntries = Object.entries(changes ?? {});
    if (changeEntries.length === 0) {
      throw new Error("No fields provided for update");
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of changeEntries) {
      validateColumnExists(key, this.columns);
      sets.push(`${quoteIdentifier(key)} = ?`);
      params.push(value);
    }

    const whereClause = buildWhereClause(where, this.columns);
    const sqlParts = [`UPDATE ${this.quotedTableName} SET ${sets.join(", ")}`];
    if (whereClause.sql) {
      sqlParts.push(`WHERE ${whereClause.sql}`);
    }

    return this.db.prepare(sqlParts.join(" ")).bind(...params, ...whereClause.params).run();
  }

  async delete(where: WhereClause): Promise<any> {
    await this.ensureSchema();
    const whereClause = buildWhereClause(where, this.columns);
    if (!whereClause.sql) {
      throw new Error("Delete requires at least one condition to avoid removing all records");
    }
    const sql = `DELETE FROM ${this.quotedTableName} WHERE ${whereClause.sql}`;
    return this.db.prepare(sql).bind(...whereClause.params).run();
  }

  private async select(
    where: WhereClause | undefined,
    order: Array<{ column: string; direction: SortDirection }>,
    limit?: number,
    offset?: number,
  ): Promise<any[]> {
    await this.ensureSchema();
    const clauses: string[] = [`SELECT * FROM ${this.quotedTableName}`];
    const params: unknown[] = [];

    const whereClause = buildWhereClause(where, this.columns);
    if (whereClause.sql) {
      clauses.push(`WHERE ${whereClause.sql}`);
      params.push(...whereClause.params);
    }

    if (order.length > 0) {
      const parts = order.map((entry) => {
        validateColumnExists(entry.column, this.columns);
        const dir = entry.direction === "desc" ? "DESC" : "ASC";
        return `${quoteIdentifier(entry.column)} ${dir}`;
      });
      clauses.push(`ORDER BY ${parts.join(", ")}`);
    }

    if (typeof limit === "number" && Number.isFinite(limit)) {
      clauses.push("LIMIT ?");
      params.push(Math.max(0, Math.trunc(limit)));
    }

    if (typeof offset === "number" && Number.isFinite(offset)) {
      clauses.push("OFFSET ?");
      params.push(Math.max(0, Math.trunc(offset)));
    }

    const stmt = this.db.prepare(clauses.join(" "));
    const result = await stmt.bind(...params).all();
    return extractResults(result);
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.initializeSchema();
    }
    try {
      await this.schemaReady;
    } catch (error) {
      this.schemaReady = null;
      throw error;
    }
  }

  private async initializeSchema(): Promise<void> {
    const createTable = buildCreateTableSql(this.collection, this.tableName);
    await this.db.prepare(createTable).run();
    for (const index of this.indexes) {
      const sql = buildCreateIndexSql(index, this.tableName);
      await this.db.prepare(sql).run();
    }
  }
}

export class AppDataAdapter {
  private readonly collections: Map<string, NormalizedCollection>;
  private readonly defaultDb: D1Database;
  private readonly options: AppDataAdapterOptions;
  private readonly cache: Map<string, AppCollectionDao>;

  constructor(
    definitions: Record<string, AppCollectionDefinition>,
    defaultDb: D1Database,
    options: AppDataAdapterOptions = {},
  ) {
    if (!defaultDb) {
      throw new Error("Default D1 database is required");
    }
    this.collections = normalizeCollections(definitions);
    this.defaultDb = defaultDb;
    this.options = options;
    this.cache = new Map();
  }

  collection(name: string, workspaceId?: WorkspaceId): AppCollectionDao {
    const normalizedName = name?.trim();
    if (!normalizedName) {
      throw new Error("Collection name is required");
    }
    const definition = this.collections.get(normalizedName);
    if (!definition) {
      throw new Error(`Unknown app collection "${normalizedName}"`);
    }

    const cacheKey = `${workspaceId ?? "__default"}::${normalizedName}`;
    const existing = this.cache.get(cacheKey);
    if (existing) return existing;

    const db = this.options.resolveDatabase?.(workspaceId) ?? this.defaultDb;
    if (!db) {
      throw new Error(`No database available for workspace "${workspaceId ?? "default"}"`);
    }

    const tableName = resolveTableName(normalizedName, workspaceId, this.options);
    const dao = new AppCollectionDao(db, definition, tableName);
    this.cache.set(cacheKey, dao);
    return dao;
  }
}

function normalizeCollections(definitions: Record<string, AppCollectionDefinition>): Map<string, NormalizedCollection> {
  const entries = new Map<string, NormalizedCollection>();
  for (const [key, value] of Object.entries(definitions ?? {})) {
    entries.set(key, normalizeCollectionDefinition(key, value));
  }
  return entries;
}

function normalizeCollectionDefinition(name: string, definition: AppCollectionDefinition): NormalizedCollection {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error(`Collection "${name}" must be an object definition`);
  }
  const engine = (definition.engine ?? "sqlite") as string;
  if (String(engine).toLowerCase() !== "sqlite") {
    throw new Error(`Collection "${name}" uses unsupported engine "${engine}"`);
  }

  const schema = (definition as any).schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`Collection "${name}" must declare a schema`);
  }

  const columns: Record<string, NormalizedColumn> = {};
  const primaryCandidates: string[] = [];
  for (const [columnName, columnDef] of Object.entries(schema)) {
    const normalized = normalizeColumnDefinition(name, columnName, columnDef);
    columns[columnName] = normalized.column;
    if (normalized.isPrimaryCandidate) {
      primaryCandidates.push(columnName);
    }
  }

  let primaryKey = normalizePrimaryKey(definition.primary_key ?? definition.primaryKey);
  if (!primaryKey && primaryCandidates.length === 1) {
    columns[primaryCandidates[0]] = { ...columns[primaryCandidates[0]], hasInlinePrimaryKey: true };
    primaryKey = undefined;
  } else if (!primaryKey && primaryCandidates.length > 1) {
    primaryKey = primaryCandidates;
  }

  const indexes = normalizeIndexes(definition.indexes, columns, name);

  return {
    name,
    engine: "sqlite",
    columns,
    primaryKey,
    indexes,
  };
}

function normalizeColumnDefinition(
  collectionName: string,
  columnName: string,
  definition: unknown,
): { column: NormalizedColumn; isPrimaryCandidate: boolean } {
  if (typeof definition === "string") {
    const sql = definition.trim();
    if (!sql) {
      throw new Error(`Column "${columnName}" in "${collectionName}" has an empty definition`);
    }
    return {
      column: {
        name: columnName,
        sql,
        hasInlinePrimaryKey: false,
      },
      isPrimaryCandidate: false,
    };
  }

  if (!definition || typeof definition !== "object") {
    throw new Error(`Column "${columnName}" in "${collectionName}" must be a string or object definition`);
  }

  const def = definition as Record<string, unknown>;
  const type = typeof def.type === "string" ? def.type.toUpperCase() : "TEXT";
  const notNull = Boolean(def.not_null ?? def.notNull);
  const unique = Boolean(def.unique);
  const isPrimary = Boolean(def.primary_key ?? def.primaryKey);
  const references = typeof def.references === "string" ? def.references.trim() : "";
  const raw = typeof def.raw === "string" ? def.raw.trim() : "";

  let defaultSql: string | undefined;
  if (Object.prototype.hasOwnProperty.call(def, "default")) {
    defaultSql = toSqlLiteral(def.default as unknown);
  }

  const parts: string[] = [];
  if (raw) {
    parts.push(raw);
  } else {
    parts.push(type);
    if (notNull) parts.push("NOT NULL");
    if (unique) parts.push("UNIQUE");
    if (defaultSql !== undefined) parts.push(`DEFAULT ${defaultSql}`);
    if (references) parts.push(`REFERENCES ${references}`);
  }

  return {
    column: {
      name: columnName,
      sql: parts.join(" "),
      hasInlinePrimaryKey: false,
    },
    isPrimaryCandidate: isPrimary,
  };
}

function normalizePrimaryKey(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    const cols = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
    if (cols.length > 0) return cols;
  }
  throw new Error("primary_key must be a string or array of strings when provided");
}

function normalizeIndexes(
  indexes: AppCollectionIndexDefinition[] | undefined,
  columns: Record<string, NormalizedColumn>,
  collectionName: string,
): NormalizedIndex[] {
  if (!indexes) return [];
  const normalized: NormalizedIndex[] = [];
  indexes.forEach((index, i) => {
    if (!index || typeof index !== "object") {
      throw new Error(`Index #${i} for collection "${collectionName}" must be an object`);
    }
    const cols = Array.isArray(index.columns)
      ? index.columns
      : typeof index.columns === "string"
        ? [index.columns]
        : null;
    if (!cols || cols.length === 0) {
      throw new Error(`Index #${i} for collection "${collectionName}" must specify at least one column`);
    }
    const cleaned = cols.map((col) => col.trim()).filter((col) => col.length > 0);
    if (cleaned.length === 0) {
      throw new Error(`Index #${i} for collection "${collectionName}" has empty column names`);
    }
    cleaned.forEach((col) => validateColumnExists(col, columns));
    const unique = Boolean(index.unique);
    const name =
      typeof index.name === "string" && index.name.trim()
        ? sanitizeIdentifier(index.name)
        : buildIndexName(collectionName, cleaned, unique);
    const where = typeof index.where === "string" && index.where.trim() ? index.where.trim() : undefined;
    normalized.push({ name, columns: cleaned, unique, where });
  });
  return normalized;
}

function buildCreateTableSql(collection: NormalizedCollection, tableName: string): string {
  const columnSql = Object.values(collection.columns).map((column) => {
    const parts = [quoteIdentifier(column.name), column.sql];
    if (column.hasInlinePrimaryKey) {
      parts.push("PRIMARY KEY");
    }
    return parts.filter(Boolean).join(" ");
  });

  if (collection.primaryKey && collection.primaryKey.length > 0) {
    const pkColumns = collection.primaryKey.map((col) => quoteIdentifier(col)).join(", ");
    columnSql.push(`PRIMARY KEY (${pkColumns})`);
  }

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (${columnSql.join(", ")})`;
}

function buildCreateIndexSql(index: NormalizedIndex, tableName: string): string {
  const columns = index.columns.map((col) => quoteIdentifier(col)).join(", ");
  const unique = index.unique ? "UNIQUE " : "";
  const where = index.where ? ` WHERE ${index.where}` : "";
  const name = sanitizeIdentifier(`${tableName}_${index.name}`);
  return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdentifier(name)} ON ${quoteIdentifier(tableName)} (${columns})${where}`;
}

function resolveTableName(name: string, workspaceId: WorkspaceId, options: AppDataAdapterOptions): string {
  const base = sanitizeIdentifier(name);
  if (!base) {
    throw new Error(`Invalid collection name "${name}"`);
  }
  const prefix = options.tableNamePrefix ?? "app_";
  const workspacePrefix = getWorkspacePrefix(workspaceId, options.workspaceTablePrefix);
  const table = `${prefix}${workspacePrefix}${base}`;
  if (!table) {
    throw new Error(`Failed to derive table name for collection "${name}"`);
  }
  return table;
}

function getWorkspacePrefix(workspaceId: WorkspaceId, prefixOption?: string | ((workspaceId: string) => string | null | undefined)): string {
  const normalized = typeof workspaceId === "string" ? workspaceId.trim() : "";
  if (!normalized) return "";
  if (typeof prefixOption === "function") {
    const custom = prefixOption(normalized);
    if (!custom) return "";
    return sanitizeIdentifier(custom);
  }
  const prefix = typeof prefixOption === "string" ? prefixOption : "ws_";
  return `${sanitizeIdentifier(prefix)}${sanitizeIdentifier(normalized)}__`;
}

function buildWhereClause(
  where: WhereClause | undefined,
  columns: Record<string, NormalizedColumn>,
): { sql: string; params: unknown[] } {
  if (!where || Object.keys(where).length === 0) {
    return { sql: "", params: [] };
  }
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const [key, raw] of Object.entries(where)) {
    validateColumnExists(key, columns);
    const column = quoteIdentifier(key);
    if (raw === null) {
      clauses.push(`${column} IS NULL`);
      continue;
    }
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const condition = raw as Record<string, unknown>;
      const allowedKeys = new Set(["in", "notIn", "gt", "gte", "lt", "lte", "not"]);
      const hasKnownKey = Object.keys(condition).some((entry) => allowedKeys.has(entry));
      if (!hasKnownKey) {
        throw new Error(`Unsupported where condition for column "${key}"`);
      }
      if (Array.isArray(condition.in)) {
        const values = condition.in;
        if (values.length === 0) {
          clauses.push("1=0");
          continue;
        }
        clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
        params.push(...values);
        continue;
      }
      if (Array.isArray(condition.notIn)) {
        const values = condition.notIn;
        if (values.length === 0) continue;
        clauses.push(`${column} NOT IN (${values.map(() => "?").join(", ")})`);
        params.push(...values);
        continue;
      }
      if (condition.gt !== undefined) {
        clauses.push(`${column} > ?`);
        params.push(condition.gt);
      }
      if (condition.gte !== undefined) {
        clauses.push(`${column} >= ?`);
        params.push(condition.gte);
      }
      if (condition.lt !== undefined) {
        clauses.push(`${column} < ?`);
        params.push(condition.lt);
      }
      if (condition.lte !== undefined) {
        clauses.push(`${column} <= ?`);
        params.push(condition.lte);
      }
      if (condition.not !== undefined) {
        if (condition.not === null) {
          clauses.push(`${column} IS NOT NULL`);
        } else {
          clauses.push(`${column} != ?`);
          params.push(condition.not);
        }
      }
      continue;
    }
    clauses.push(`${column} = ?`);
    params.push(raw);
  }
  return { sql: clauses.join(" AND "), params };
}

function validateColumnExists(name: string, columns: Record<string, NormalizedColumn>): void {
  if (!columns[name]) {
    throw new Error(`Column "${name}" is not defined in this collection`);
  }
}

function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_{3,}/g, "__").replace(/^_+/, "");
}

function quoteIdentifier(name: string): string {
  const cleaned = sanitizeIdentifier(name);
  if (!cleaned) {
    throw new Error("Identifier cannot be empty");
  }
  return `"${cleaned}"`;
}

function buildIndexName(collectionName: string, columns: string[], unique: boolean): string {
  const base = sanitizeIdentifier(collectionName);
  const cols = columns.map((col) => sanitizeIdentifier(col)).join("_");
  return `${unique ? "uidx" : "idx"}_${base}_${cols}`.toLowerCase();
}

function toSqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw new Error("default value must be a string, number, boolean, or null");
}

function extractResults(result: any): any[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.results)) return result.results;
  if (result.result && Array.isArray(result.result)) return result.result;
  return [];
}
