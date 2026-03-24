export default {
  async fetch(request: Request, env: any): Promise<Response> {
    // Static-site mode: serve assets only (no API/backend routes).
    return env.ASSETS.fetch(request);
  },
};

