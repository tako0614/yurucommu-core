// deno-lint-ignore-file
import { Client } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import { isMail, isUserDuplication, isMailDuplication, isMailDuplicationTemp, isCsrftoken, sendMail,client} from "../../../util/takoFunction.ts";

export const handler = {
    async GET(req, ctx) {
        const url = new URL(req.url);
        const key = url.searchParams.get("key") || "";

        //return ctx.render({ userName });
    },
};