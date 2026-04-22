import { render } from "solid-js/web";
import type { Component } from "solid-js";
import DefaultApp from "./App.tsx";
import {
  type ApiTransport,
  type AuthCheckResult,
  type AuthStrategy,
  clearYurucommuFrontendPlugin,
  type DeploymentMode,
  type FrontendPluginContextV1,
  type HostedInstance,
  type HostedUserInfo,
  type InstanceHealth,
  type InstanceHealthChecks,
  type LoginResult,
  setYurucommuFrontendPlugins,
  type SlotEntry,
  type SlotName,
  type YurucommuFrontendPluginV1,
} from "./lib/plugin.ts";

export type {
  ApiTransport,
  AuthCheckResult,
  AuthStrategy,
  DeploymentMode,
  FrontendPluginContextV1,
  HostedInstance,
  HostedUserInfo,
  InstanceHealth,
  InstanceHealthChecks,
  LoginResult,
  SlotEntry,
  SlotName,
  YurucommuFrontendPluginV1,
};

export interface BootstrapMountOptionsV1 {
  rootId?: string;
}

export interface BootstrapYurucommuFrontendOptionsV1 {
  plugins?: YurucommuFrontendPluginV1[];
  mount?: BootstrapMountOptionsV1;
  AppComponent?: Component;
}

let bootstrapped = false;

export function bootstrapYurucommuFrontend(
  options: BootstrapYurucommuFrontendOptionsV1 = {},
): void {
  if (bootstrapped) {
    throw new Error("[yurucommu] frontend already bootstrapped");
  }

  const rootId = options.mount?.rootId ?? "root";
  const AppComponent = options.AppComponent ?? DefaultApp;
  const plugins = options.plugins ?? [];

  clearYurucommuFrontendPlugin();
  setYurucommuFrontendPlugins(plugins);

  const container = document.getElementById(rootId);
  if (!container) {
    throw new Error(`[yurucommu] root element not found: #${rootId}`);
  }

  render(() => <AppComponent />, container);
  bootstrapped = true;
}

export default bootstrapYurucommuFrontend;
