import { render } from "solid-js/web";
import App from "./App";
import { initTheme } from "./lib/theme";
import {
  configureClient,
  getClientConfig,
  getConfiguredBackendOrigin,
  getConfiguredHostHandle,
  isSelfHostedMode,
  type ClientConfig,
} from "./lib/config";
import { registerClientPlugin } from "./lib/plugins";
export type { ClientPlugin } from "./lib/plugins";

export type { ClientConfig } from "./lib/config";
export {
  configureClient,
  getClientConfig,
  getConfiguredBackendOrigin,
  getConfiguredHostHandle,
  isSelfHostedMode,
  registerClientPlugin,
};

export interface BootstrapOptions {
  /**
   * DOM element to mount the Solid application onto.
   * Defaults to `document.getElementById("root")`.
   */
  element?: HTMLElement | null;
  /** Optional client configuration overrides */
  config?: Partial<ClientConfig>;
  /** Whether to call initTheme before mounting (defaults to true) */
  withTheme?: boolean;
}

export function bootstrapClient(options: BootstrapOptions = {}): void {
  const target =
    options.element ??
    (typeof document !== "undefined" ? document.getElementById("root") : null);
  if (!target) {
    throw new Error("bootstrapClient: root element not found");
  }
  if (options.config) {
    configureClient(options.config);
  }
  if (options.withTheme !== false) {
    initTheme();
  }
  render(() => <App />, target);
}

export default App;
