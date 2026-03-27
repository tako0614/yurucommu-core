interface SiteWorkerEnv {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: SiteWorkerEnv): Promise<Response> {
    // Static-site mode: serve assets only (no API/backend routes).
    return env.ASSETS.fetch(request);
  },
};

