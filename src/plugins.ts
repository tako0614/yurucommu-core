export { YURUCOMMU_PLUGIN_API_VERSION } from './plugin/public';
export { YURUCOMMU_BACKEND_PLUGIN_API_VERSION } from './backend/public';
export { YURUCOMMU_FRONTEND_PLUGIN_API_VERSION } from './frontend/src/lib/plugin';

export type {
  BackendPluginContextV1,
  YurucommuBackendPluginV1,
  CreateYurucommuBackendAppOptionsV1,
} from './backend/public';

export type {
  AuthStrategy,
  ApiTransport,
  DeploymentMode,
  HostedUserInfo,
  HostedInstance,
  InstanceHealthChecks,
  InstanceHealth,
  AuthCheckResult,
  LoginResult,
  FrontendPluginContextV1,
  YurucommuFrontendPluginV1,
  BootstrapMountOptionsV1,
  BootstrapYurucommuFrontendOptionsV1,
  SlotName,
  SlotEntry,
} from './frontend/src/public';
