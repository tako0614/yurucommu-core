// deno-lint-ignore-file
import { isMail, isUserDuplication, isMailDuplication, isMailDuplicationTemp, isCsrftoken, sendMail} from "../../../util/takoFunction.ts";
import { useState, useEffect } from "preact/hooks";
export const handler = {
    async POST(req, ctx) {
        const data = await req.json();
        //const[userName, password,age]
    }
}