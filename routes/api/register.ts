/*import { Handlers, PageProps } from "$fresh/server.ts";
import database from "../../util/database.ts";

interface Data {
    userName: string;
  }
  
export const handler: Handlers<Data> = {
    async GET(req, ctx) {
      const url = new URL(req.url);
      //console.log(url);
      const key = url.searchParams.get("userName") || "";
      //const result = await database.execute(`SELECT * FROM temp_users WHERE key = "${key}"`);
      console.log(result);
      return new Response(JSON.stringify({userName}));
      //return ctx.render(JSON.stringify(user));
    },
};
/*
export const handler: Handlers<Data> = {
  async POST(req, ctx) {
    try {
		    const request = (await req.json());
        let result;
        switch (request) {
          case request.requirements == "temp_register":
            return temp_register(request);
            break;
          case request.requirements == "login":
            result = login(request);
            if(result.status === true) {
              return new Response({status: true, message: "success" , uuid: result.uuid});
            }
            break;
          default:
            return new Response({status: false, message: "json is invalid"});
            break;
        }
        //return new Response(JSON.stringify(user));
	} catch (error) {
		return new Response({status: false, message: "server error"});
	}
  },
};*/