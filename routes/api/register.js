export const handler = {
  async POST(req) {
    const request = (await req.url());
    console.log(req)
    const a = {
      "a": "a"
    }
    return new Response(JSON.stringify(a))
  },
};