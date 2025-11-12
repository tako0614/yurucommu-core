/* @refresh reload */
import "./index.css";
import { bootstrapClient } from "./client";
import { DEFAULT_HOST_ORIGIN, type ClientConfig } from "./lib/config";

const env = import.meta.env as Record<string, string | undefined>;
const rootOrigin = typeof window !== "undefined" ? window.location.origin : null;

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

function resolveDefaultBackend(): string {
  return (
    resolveEnvBackend() ||
    rootOrigin ||
    DEFAULT_HOST_ORIGIN
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
