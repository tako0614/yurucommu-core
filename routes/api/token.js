import csrfToken from "../../models/csrftoken.js";
import {envRoader} from "../../util/takoFunction.ts";
export const handler = {
  async GET(req) {
    const url = new URL(req.url);
    const origin = url.searchParams.get("origin") || "";
    const allows = envRoader("origin")
    const allow = allows.split(',')
    if(allow.includes(origin)){
      const csrftoken = generateRandomString(128)
      await csrfToken.create({token: csrftoken})
      return new Response(JSON.stringify({"csrftoken": csrftoken}), {
        headers: { "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": origin
        },
      }
      );
    }else {
      return new Response(JSON.stringify({"csrftoken": "This origin is not allowed"}), {
        headers: { "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": origin
        },
      }
      );
    }
  }
};
function generateRandomString(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters.charAt(randomIndex);
  }
  return result;
}