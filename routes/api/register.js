export const handler = {
  async POST(req) {
    console.log(req.body)
    const a = {
      "a": "a"
    }
    const request = await req;
    return new Response(JSON.stringify(req))
  },
};