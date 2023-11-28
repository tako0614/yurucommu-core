/*import { Handlers, PageProps } from "$fresh/server.ts";
function isJson(data) {
	try {
		const isjson = req.json();
	} catch (error) {
		return false;
	}
	return true;
}
export const handler: Handlers<Data> = {
  async POST(req, ctx) {
    try {
		const user = (await req.json());
        return new Response(JSON.stringify(user));
	} catch (error) {
		return new Response("Error: Invalid JSON");
	}
  },
};*/