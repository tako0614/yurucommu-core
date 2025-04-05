import { Hono } from "hono";

type Env = {
  domain: string;
  serverName: string;
  explain: string;
};

const app = new Hono<{ Bindings: Env }>();

export default app;

export type { Env };
