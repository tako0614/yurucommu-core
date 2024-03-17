import csrfToken from "../../models/csrftoken.js";
import {envRoader} from "../../util/takoFunction.ts";
import { crypto } from "https://deno.land/std@0.220.1/crypto/crypto.ts";
export const handler = {
  async GET(req) {
    const url = new URL(req.url);
    const origin = url.searchParams.get("origin") || "";
    const allows = envRoader("origin")
    const allow = allows.split(',')
    if(allow.includes(origin)){
      const array = new Uint8Array(64);
      crypto.getRandomValues(array);
      const csrftoken = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
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