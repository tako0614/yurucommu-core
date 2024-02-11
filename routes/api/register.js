export const handler = {
  POST(req) {
    console.log(req.body)
    const a = {
      "a": "a"
    }
    return new Response(JSON.stringify(a))
  },
};