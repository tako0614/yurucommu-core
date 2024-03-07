export const tali = () => {
    const { response, socket } = Deno.upgradeWebSocket(c.req);

    // websocketのハンドリング
    socket.addEventListener("message", (e) => console.log(e));
    return response;
}
