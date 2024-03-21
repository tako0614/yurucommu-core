export const handler = {
  GET(req) {
    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      if (!socket) throw new Error("unreachable");
      socket.onmessage = (ev) => {
        socket.send(ev.data);
      };
      socket.onopen = () => {
        socket.send("Hello from the client!");
      };
      return response;
    } else {
      return new Response(
        JSON.stringify({ response: "the request is a normal HTTP request" }),
      );
    }
  },
};
