import React, { type ComponentType } from 'react';
import ReactDOM from 'react-dom/client';
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
  strictMode?: boolean;
}

export interface BootstrapYurucommuFrontendOptionsV1 {
  plugins?: YurucommuFrontendPluginV1[];
  mount?: BootstrapMountOptionsV1;
  AppComponent?: ComponentType;
}

let bootstrapped = false;

export function bootstrapYurucommuFrontend(options: BootstrapYurucommuFrontendOptionsV1 = {}): void {
  if (bootstrapped) {
    throw new Error('[yurucommu] frontend already bootstrapped');
  }

  const rootId = options.mount?.rootId ?? 'root';
  const strictMode = options.mount?.strictMode ?? true;
  const AppComponent = options.AppComponent ?? DefaultApp;
  const plugins = options.plugins ?? [];

  clearYurucommuFrontendPlugin();
  setYurucommuFrontendPlugins(plugins);

  const container = document.getElementById(rootId);
  if (!container) {
    throw new Error(`[yurucommu] root element not found: #${rootId}`);
  }

  const appElement = strictMode
    ? (
      <React.StrictMode>
        <AppComponent />
      </React.StrictMode>
    )
    : <AppComponent />;

  ReactDOM.createRoot(container).render(appElement);
  bootstrapped = true;
}

export default bootstrapYurucommuFrontend;
