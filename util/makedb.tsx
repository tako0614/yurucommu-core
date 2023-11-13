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
queries = {
    //make database
    
    //tables
    users:`CREATE TABLE users (
        id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,
    
}

export default async function makeDB() {
    queries.forEach(async (query) => {
        let result = await client.execute(query);
        console.log(result);
    })
}