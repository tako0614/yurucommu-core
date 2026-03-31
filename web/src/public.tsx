import { render } from 'solid-js/web';
import type { Component } from 'solid-js';
import DefaultApp from './App.tsx';
import {
  clearYurucommuFrontendPlugin,
  setYurucommuFrontendPlugins,
  type FrontendPluginContextV1,
  type YurucommuFrontendPluginV1,
  type AuthStrategy,
  type ApiTransport,
  type DeploymentMode,
  type HostedUserInfo,
  type HostedInstance,
  type InstanceHealthChecks,
  type InstanceHealth,
  type AuthCheckResult,
  type LoginResult,
  type SlotName,
  type SlotEntry,
} from './lib/plugin.ts';

export type {
  FrontendPluginContextV1,
  YurucommuFrontendPluginV1,
  AuthStrategy,
  ApiTransport,
  DeploymentMode,
  HostedUserInfo,
  HostedInstance,
  InstanceHealthChecks,
  InstanceHealth,
  AuthCheckResult,
  LoginResult,
  SlotName,
  SlotEntry,
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

export function bootstrapYurucommuFrontend(options: BootstrapYurucommuFrontendOptionsV1 = {}): void {
  if (bootstrapped) {
    throw new Error('[yurucommu] frontend already bootstrapped');
  }

  const rootId = options.mount?.rootId ?? 'root';
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
