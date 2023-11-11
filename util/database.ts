import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import { Client } from "https://deno.land/x/mysql/mod.ts";
const env = await load();
const hostname: string= env["hostname"] 
const username: string = env["username"] 
const db: string = env["db"] 
const password: string = env["password"]
const client = await new Client().connect({
  hostname: hostname,
  username: username,
  db: db,
  password: password,
});  
const database = {
  async insert(table: string,columns: string,values: string): string {
    if(columns.length == values.length){
    let valu: string = [];
    values.forEach(element => {
      valu.push(`"${element}"`);
    });
    const column = columns.join(",")
    const value = valu.join(",")
    let result = await client.execute(`INSERT INTO ${table} (${column}) VALUES (${value});`);
    return result
    } else {
      return "error"
    }
  },
  async select(table: string, columns: string[], where?: string): Promise<any[]> {
    let query = `SELECT ${Array.isArray(columns) ? columns.join(",") : columns} FROM ${table}`;
    if (where) {
      query += ` WHERE ${where}`;
    }
    const result = await client.execute(query);
    return query;//result.rows;
  },
  
  
    make: {
      database() {
        //
      },
      table() {
      },
    },
    test:username
  }  
export default database;

