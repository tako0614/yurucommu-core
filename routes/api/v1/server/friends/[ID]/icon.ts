export const handler = {
    async GET(req: Request, ctx: any) {
        const { ID } = ctx.params
        const requrl = new URL(req.url)
        const token = requrl.searchParams.get("token") || false
        const reqUser = requrl.searchParams.get("reqUser") || false
        if (ID === undefined || token === false || reqUser === false) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        
    },
}