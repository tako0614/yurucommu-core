export const handler = {
  async POST(req) {
      const data = await req.json();
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
  }
};