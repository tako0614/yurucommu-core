import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import { Client } from "https://deno.land/x/mysql/mod.ts";

const env = await load();
const hostname = env["hostname"];
const username = env["username"];
const db = env["db"];
const password = env["password"];

const client = await new Client().connect({
  hostname,
  username,
  db,
  password,
});

const database = {
  async insert(table: string, columns: string[], values: string[]): Promise<any> {
    if (columns.length !== values.length) {
      return "error";
    }

    const valu = values.map((element) => `"${element}"`);
    const column = columns.join(",");
    const value = valu.join(",");

    const result = await client.execute(`INSERT INTO ${table} (${column}) VALUES (${value});`);
    return result;
  },
  async select(table: string, columns: string | string[], where?: string): Promise<any[]> {
    let query = `SELECT ${Array.isArray(columns) ? columns.join(",") : columns} FROM ${table}`;

    if (where) {
      query += ` WHERE ${where}`;
    }

    const result = await client.execute(query);
    return result.rows;
  },

  async update(table: string, columns: string[], values: string[], where?: string): Promise<any> {
    const set = columns.map((column, index) => `${column} = "${values[index]}"`);
    let query = `UPDATE ${table} SET ${set.join(", ")}`;

    if (where) {
      query += ` WHERE ${where}`;
    }

    const result = await client.execute(query);
    return result;
  },

  make: {
    database() {
      //
    },
    table() {
      //
    },
  },

  test: username,
};

export default database;
