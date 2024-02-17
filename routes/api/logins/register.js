export const handler = {
  async POST(req) {
      //const data = await req.json();
      const data = {
        "status": "success"
      }
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
  }
};