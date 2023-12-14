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
let queries = {
    temp_users: `CREATE TABLE temp_users (
        id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        mail VARCHAR(255) NOT NULL,
        kye VARCHAR(255) NOT NULL UNIQUE
    );`,
    users: `CREATE TABLE users (
        id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        mail VARCHAR(255) NOT NULL,
        salt VARCHAR(255) NOT NULL,
        uuid VARCHAR(255) NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,
    forinUsers : `CREATE TABLE forinUsers (
        id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        server VARCHAR(255) NOT NULL,
    )`,
    OAuth2:`CREATE TABLE OAuth2 (
        id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        provider VARCHAR(255) NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );`,
    csrftoken:`CREATE TABLE csrftoken (
        kye VARCHAR(255) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sessionid VARCHAR(255) NOT NULL
    );`,
}
function makeDB() {
    const value = Object.values(queries)
    value.forEach(async (query) => {
    let result = await client.execute(query);
    console.log(result);
    })
}
makeDB()