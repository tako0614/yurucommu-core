/* @refresh reload */
import "./index.css";
import { bootstrapClient } from "./client";
import { DEFAULT_HOST_ORIGIN, type ClientConfig } from "./lib/config";

const env = import.meta.env as Record<string, string | undefined>;
const rootOrigin = typeof window !== "undefined" ? window.location.origin : null;

function resolveDomainParam(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const domainParam = params.get("domain")?.trim();
  if (!domainParam) return null;
  try {
    const normalized = domainParam.includes("://")
      ? domainParam
      : `https://${domainParam}`;
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}`;
  } catch {
    console.warn("ignoring invalid domain param:", domainParam);
    return null;
  }
}

function resolveEnvBackend(): string | null {
  const configured = env?.VITE_BACKEND_URL;
  if (typeof configured === "string") {
    const trimmed = configured.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function resolveDefaultBackend(): string | null {
  return (
    resolveEnvBackend() ??
    resolveDomainParam() ??
    rootOrigin ??
    (DEFAULT_HOST_ORIGIN || null)
  );
}

function start() {
  const config: Partial<ClientConfig> = {
    backendOrigin: resolveDefaultBackend(),
    mode: "selfHosted",
  };
  bootstrapClient({ config });
}

start();
