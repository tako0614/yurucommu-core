import { Handlers, PageProps } from "$fresh/server.ts";
import database from "../../util/database.ts";

async function register(request) {
  const username = request.username;
  const email = request.email;
  const isDuplicationUsername = await database.execute("")
}
function login(request) {
  //
} 
export const handler: Handlers<Data> = {
  async POST(req, ctx) {
    try {
		    const request = (await req.json());
        let result;
        switch (request) {
          case request.requirements == "register":
            return register(request);
            break;
          case request.requirements == "login":
            result = login(request);
            if(result.status === true) {
              return new Response({status: true, message: "success" , uuid: result.uuid});
            }
            break;
          default:
            return new Response("Error: Invalid JSON");
            break;
        }
        //return new Response(JSON.stringify(user));
	} catch (error) {
		return new Response("Error: Invalid JSON");
	}
  },
};