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
    //make database

    //tables
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
        solt VARCHAR(255) NOT NULL,
        uuid VARCHAR(255) NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,
    posts:`CREATE TABLE post (
        id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        post_id INT NOT NULL,
        post TXT(10000) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );`,
    OAuth2:`CREATE TABLE OAuth2 (
        id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        provider VARCHAR(255) NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );`,
}
changes = {
    temp_users: {
        //
    },
    users: {
        //
    },
    posts: {
        //
    },
    posts: {    
        //
    },
    OAuth2: {
        //
    },
    
}
export default async function makeDB() {
    queries.forEach(async (query) => {
    let result = await client.execute(query);
    console.log(result);
    })
}
makeDB()