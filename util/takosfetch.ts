import { load } from "$std/dotenv/mod.ts"
const env = await load()
const PRIORITY_PROTOCOL = env["PRIORITY_PROTOCOL"]
export async function takosfetch(url: string, options = {}) {
    try {
        if(PRIORITY_PROTOCOL === "https") {
            return await fetch(`https://${url}`, options);
        } else {
            return await fetch(`http://${url}`, options);
        }
    } catch (_e) {
        //
    }
    try {
    console.log("Trying to fetch with http")
        if(PRIORITY_PROTOCOL === "https") {
            return await fetch(`http://${url}`, options);
        } else {
            return await fetch(`https://${url}`, options);
        }
    } catch (_e) {
        return null;
    }
}