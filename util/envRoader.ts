import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
const env = await load();

export default function envRoader(value: array<string>) {
    const result = value.map((element) => env[element]);
    //const result = env[value];
    return result;
}
const {smtp_host, smtp_port, smtp_auth_user, smtp_auth_pass, smtp_ssl} = envRoader(["smtp_host", "smtp_port", "smtp_username", "smtp_password", "tls"]);
console.log(smtp_host)