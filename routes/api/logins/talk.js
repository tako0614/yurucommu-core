import { isCsrftoken } from "../../../util/takoFunction.ts";
export const handler = {
    GET(req) {
        if (req.headers.get("upgrade") === "websocket") {
        const { socket, response } = Deno.upgradeWebSocket(req);
        if (!socket) throw new Error("unreachable");
        /*if(!isCsrftoken(req.body.token)) {
            return new Response({})
        }*/
        //アカウント認証
        socket.onmessage = (ev) => {
            socket.send(ev.data);
        };
        //socket.onclose = () => {
        //socket.send("Hello from the client!");
        //};
        socket.onopen = () => {
        socket.send("Hello from the client!");
        };
        return response;
        } else {
            return new Response(JSON.stringify({response: "the request is a normal HTTP request"}));
        }
    },
  };