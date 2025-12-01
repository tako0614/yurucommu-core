import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { fail, ok, requireInstanceDomain } from "@takos/platform/server";
import { signPushPayload } from "../lib/push-registration";
import {
  buildPushWellKnownPayload,
  resolvePushTarget,
} from "../lib/push-check";

type AdminAuthResult =
  | { ok: true; admin: string }
  | { ok: false; status: number; message: string };

function decodeBasicAuth(encoded: string): string | null {
  try {
    return atob(encoded);
  } catch {
    return null;
  }
}

function checkAdminAuth(c: any): AdminAuthResult {
  const username = c.env.AUTH_USERNAME?.trim();
  const password = c.env.AUTH_PASSWORD?.trim();
  if (!username || !password) {
    return { ok: false, status: 500, message: "admin credentials are not configured" };
  }
  const header = c.req.header("Authorization") || "";
  if (!header.startsWith("Basic ")) {
    return { ok: false, status: 401, message: "admin basic auth required" };
  }
  const encoded = header.slice("Basic ".length).trim();
  const decoded = decodeBasicAuth(encoded);
  if (!decoded || !decoded.includes(":")) {
    return { ok: false, status: 401, message: "invalid authorization header" };
  }
  const [user, ...rest] = decoded.split(":");
  const pass = rest.join(":");
  if (user !== username || pass !== password) {
    return { ok: false, status: 401, message: "invalid credentials" };
  }
  return { ok: true, admin: user };
}

type PushVerifyRequest = {
  sendTest?: boolean;
  userId?: string;
  target?: "gateway" | "default";
  message?: string;
};

const adminPush = new Hono<{ Bindings: Bindings; Variables: Variables }>();

adminPush.use("/admin/push/*", async (c, next) => {
  const auth = checkAdminAuth(c);
  if (!auth.ok) {
    if (auth.status === 401) {
      c.header("WWW-Authenticate", 'Basic realm="takos-admin"');
    }
    return fail(c as any, auth.message, auth.status);
  }
  (c as any).set("adminUser", auth.admin);
  await next();
});

const buildTestPayload = (instance: string, userId: string, message?: string) => ({
  instance,
  tenant: instance,
  userId,
  notification: {
    id: `push-test-${crypto.randomUUID()}`,
    type: "test",
    message: message || "Push notification setup test",
  },
});

adminPush.post("/admin/push/verify", async (c) => {
  const env = c.env as Bindings;
  let instance: string;
  try {
    instance = requireInstanceDomain(env);
  } catch (error: any) {
    return fail(c as any, error?.message || "INSTANCE_DOMAIN must be configured", 500);
  }

  const wellKnownPayload = buildPushWellKnownPayload(env);
  const wellKnownUrl = `https://${instance}/.well-known/takos-push.json`;
  const hasPublicKey = !!env.PUSH_REGISTRATION_PUBLIC_KEY?.trim();
  const hasPrivateKey = !!env.PUSH_REGISTRATION_PRIVATE_KEY?.trim();

  const guidance: string[] = [];
  if (!hasPublicKey || !hasPrivateKey) {
    guidance.push(
      "Generate a P-256 keypair (npm run generate:push-key) and set PUSH_REGISTRATION_PRIVATE_KEY (secret) plus PUSH_REGISTRATION_PUBLIC_KEY (var).",
      `Deploy and confirm ${wellKnownUrl} returns registrationPublicKey and webhook.publicKey.`,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as PushVerifyRequest;
  const sendTest = body.sendTest !== false;
  const preferredTarget = body.target === "default" ? "default" : "gateway";
  const target = resolvePushTarget(env, preferredTarget);

  if (target.type === "none") {
    guidance.push(
      "Configure PUSH_GATEWAY_URL for your host gateway or set DEFAULT_PUSH_SERVICE_URL to use the shared takos-private service.",
    );
  }

  const userId =
    typeof body.userId === "string" && body.userId.trim()
      ? body.userId.trim()
      : ((c as any).get("adminUser") as string) || "push-admin";

  const testPayload = hasPrivateKey
    ? buildTestPayload(instance, userId, body.message)
    : null;

  let signedPayload: { payload: any; signature: string } | null = null;
  let signingError: string | null = null;

  if (testPayload) {
    try {
      const signature = await signPushPayload(env, testPayload);
      signedPayload = { payload: testPayload, signature };
    } catch (error: any) {
      signingError = error?.message || "failed to sign payload";
    }
  }

  const testSend: Record<string, any> = {
    status: "skipped",
    target: target.type,
    endpoint: target.url,
  };

  if (!sendTest) {
    testSend.reason = "sendTest disabled";
  } else if (!hasPrivateKey) {
    testSend.reason = "PUSH_REGISTRATION_PRIVATE_KEY is not configured";
  } else if (!target.url) {
    testSend.reason = "no push gateway or default service configured";
  } else if (signingError) {
    testSend.status = "error";
    testSend.error = signingError;
  } else if (signedPayload) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (signedPayload.signature) {
        headers["X-Push-Signature"] = signedPayload.signature;
      }
      if (target.secret) {
        headers["X-Push-Secret"] = target.secret;
      }
      const response = await fetch(target.url, {
        method: "POST",
        headers,
        body: JSON.stringify(signedPayload.payload),
      });
      const contentType = response.headers.get("content-type") || "";
      let responseBody: any = null;
      if (contentType.includes("application/json")) {
        responseBody = await response.json().catch(() => null);
      } else {
        const text = await response.text().catch(() => "");
        responseBody = text || null;
      }
      testSend.status = response.ok ? "ok" : "error";
      testSend.responseStatus = response.status;
      testSend.responseBody = responseBody;
      if (
        responseBody &&
        typeof responseBody === "object" &&
        "delivered" in responseBody
      ) {
        testSend.delivered = (responseBody as any).delivered;
      }
      if (!response.ok) {
        testSend.error =
          (responseBody as any)?.error ||
          (typeof responseBody === "string" && responseBody) ||
          "push service responded with an error";
      }
    } catch (error: any) {
      testSend.status = "error";
      testSend.error = error?.message || "test send failed";
    }
  }

  return ok(c as any, {
    instance,
    keys: {
      hasPublicKey,
      hasPrivateKey,
    },
    wellKnown: {
      status: wellKnownPayload ? "ok" : "missing",
      url: wellKnownUrl,
      payload: wellKnownPayload,
    },
    testPayload: signedPayload,
    testSend,
    guidance,
  });
});

export default adminPush;
