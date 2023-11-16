export const handler = (_req: Request, _ctx: HandlerContext): Response => {
  const body = {
    tako: "tako"
  }
  return new Response(JSON.stringify( body ));
};