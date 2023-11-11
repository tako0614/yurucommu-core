import { Client } from "https://deno.land/x/mysql/mod.ts";
import database from "../util/database.ts";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
const env = await load();
const hostname= env["hostname"] 
const username = env["username"] 
const db = env["db"] 
const password = env["password"] 
const client = await new Client().connect({
  hostname: hostname,
  username: username,
  db: db,
  password: password,
}); 
export default async function privacy() {
  const user = "John";
  const tako = "Tako";
  //const result = await database.insert("test_table", ["name","password","status"], ["tako","tako","tako"]);
  const result = await database.select("test_table","password", "id =1")
  console.log(result)
  //const id = `your id is ${result.lastInsertId}`
  //return (<div>{id}</div>);
}