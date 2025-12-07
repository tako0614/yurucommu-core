import type { AppAuthContext } from "../runtime/types";

export type AuthLoginResult = {
  user: any;
  token?: string;
  session?: { id: string; expires_at: string | null };
  setCookies?: string[];
};

export type ActorChangeResult = {
  user: any;
  active_user_id: string | null;
  created?: boolean;
  token?: string;
  setCookies?: string[];
};

export interface AuthService {
  loginWithPassword(input: { password: string; handle?: string | null }): Promise<AuthLoginResult>;
  issueSessionToken(ctx: AppAuthContext): Promise<{ token: string; user?: any }>;
  createOrActivateActor(
    ctx: AppAuthContext,
    input: {
      handle?: string;
      display_name?: string;
      create?: boolean;
      activate?: boolean;
      issueToken?: boolean;
    },
  ): Promise<ActorChangeResult>;
  logout(): Promise<{ success: boolean; setCookies?: string[] }>;
}

export type AuthServiceFactory = (env: unknown) => AuthService;
