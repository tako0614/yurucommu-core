import type { DataStore, FaspProvidersRepo as CoreFaspProvidersRepo } from "../../core/db/types.ts";

export interface TenantRepo {
  ensure(id: string): Promise<void>;
}

export interface HostRepo {
  listInstances(owner: string): Promise<{ host: string }[]>;
  countInstances(owner: string): Promise<number>;
  findInstanceByHost(
    host: string,
  ): Promise<
    | { _id: string; host: string; owner: string; env?: Record<string, string> }
    | null
  >;
  findInstanceByHostAndOwner(
    host: string,
    owner: string,
  ): Promise<
    { _id: string; host: string; env?: Record<string, string> } | null
  >;
  createInstance(
    data: { host: string; owner: string; env?: Record<string, string> },
  ): Promise<void>;
  updateInstanceEnv(id: string, env: Record<string, string>): Promise<void>;
  deleteInstance(host: string, owner: string): Promise<void>;
}

export interface OAuthRepo {
  list(): Promise<{ clientId: string; redirectUri: string }[]>;
  find(clientId: string): Promise<{ clientSecret: string; redirectUri: string } | null>;
  create(
    data: { clientId: string; clientSecret: string; redirectUri: string },
  ): Promise<void>;
  // Authorization Code フロー用
  createCode(data: { code: string; clientId: string; user: string; expiresAt: Date }): Promise<void>;
  findCode(code: string, clientId: string): Promise<{ user: string; expiresAt: Date } | null>;
  deleteCode(code: string): Promise<void>;
  createToken(data: { token: string; clientId: string; user: string; expiresAt: Date }): Promise<void>;
  findToken(token: string): Promise<{ user: string; expiresAt: Date } | null>;
}

export interface DomainsRepo {
  list(user: string): Promise<{ domain: string; verified: boolean }[]>;
  find(
    domain: string,
    user?: string,
  ): Promise<{ _id: string; token: string; verified: boolean } | null>;
  create(domain: string, user: string, token: string): Promise<void>;
  verify(id: string): Promise<void>;
}

// FASP プロバイダ操作用リポジトリ
export interface FaspProvidersRepo extends CoreFaspProvidersRepo {
  findByBaseUrl(
    baseUrl: string,
  ): Promise<{ secret?: string } | null>;
  createDefault(data: {
    name: string;
    baseUrl: string;
    serverId: string;
    secret: string;
  }): Promise<void>;
  updateSecret(baseUrl: string, secret: string): Promise<void>;
}

// ホスト管理ユーザー操作用リポジトリ
export interface HostUserData {
  _id: string;
  userName: string;
  email: string;
  emailVerified: boolean;
  verifyCode?: string;
  verifyCodeExpires?: Date;
  hashedPassword: string;
  salt: string;
}

export interface HostUserRepo {
  findById(id: string): Promise<HostUserData | null>;
  findByUserName(userName: string): Promise<HostUserData | null>;
  findByUserNameOrEmail(
    userName: string,
    email: string,
  ): Promise<HostUserData | null>;
  create(data: {
    userName: string;
    email: string;
    hashedPassword: string;
    salt: string;
    verifyCode: string;
    verifyCodeExpires: Date;
    emailVerified?: boolean;
  }): Promise<HostUserData>;
  update(
    id: string,
    data: Partial<{
      userName: string;
      email: string;
      hashedPassword: string;
      salt: string;
      verifyCode: string | null;
      verifyCodeExpires: Date | null;
      emailVerified: boolean;
    }>,
  ): Promise<void>;
}

// ホスト管理セッション操作用リポジトリ
export interface HostSessionData {
  _id?: string;
  sessionId: string;
  expiresAt: Date;
  user: string;
}

export interface HostSessionRepo {
  findById(sessionId: string): Promise<HostSessionData | null>;
  create(data: {
    sessionId: string;
    user: string;
    expiresAt: Date;
  }): Promise<HostSessionData>;
  update(
    sessionId: string,
    data: { expiresAt: Date },
  ): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export interface HostDataStore extends DataStore {
  tenantId: string;
  multiTenant: boolean;
  tenant: TenantRepo;
  host: HostRepo;
  oauth: OAuthRepo;
  domains: DomainsRepo;
  faspProviders: FaspProvidersRepo;
  hostUsers: HostUserRepo;
  hostSessions: HostSessionRepo;
}
