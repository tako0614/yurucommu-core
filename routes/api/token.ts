import { Handlers } from "$fresh/server.ts";
//import { re } from "$std/semver/_shared.ts";
//import { isMail, isUserDuplication, isMailDuplication, generateSalt, /*hashPassword,*/ sendMail,client} from "../../util/takoFunction.ts";
const arrow_domain = [
    "takos.jp",
    "dev.takoserver.com"
]
export const handler: Handlers = {
    async POST(req) {
      const request = (await req.json());
      console.log(request.requirements);
      console.log(result);
      
    },
  };