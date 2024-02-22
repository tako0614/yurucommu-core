import { isEmail } from "https://deno.land/x/isemail/mod.ts";

// Pass the email you want check it as argument
console.log(isEmail('username@domain.com')) // true
console.log(isEmail('あああ@do07main.com')) // false
