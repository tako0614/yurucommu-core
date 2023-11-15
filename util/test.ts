export const handler = (_req: Request, _ctx: HandlerContext): Response => {
    _req.json().then((body) => {
      const { username, password } = body;
      console.log(username);
    });
    const data = {
      message: "Hello, world!"
    };
    
    return {
      status: 200,
      body: JSON.stringify(data),
      headers: {
        "content-type": "application/json"
      }
    };
  };