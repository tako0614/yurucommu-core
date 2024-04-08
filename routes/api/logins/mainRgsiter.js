// deno-lint-ignore-file
import {
  isMailDuplication,
  isUserDuplication,
} from "../../../util/takoFunction.ts"
import tempUsers from "../../../models/tempUsers.js"
import users from "../../../models/users.js"
import * as mod from "https://deno.land/std@0.220.1/crypto/mod.ts"
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts"
const env = await load()
const secretKey = env["rechapcha_seecret_key"]
export const handler = {
  async POST(req, ctx) {
  },
}
