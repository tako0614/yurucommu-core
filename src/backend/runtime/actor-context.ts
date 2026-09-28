/**
 * Application-facing structural types for the selected, unpublished Actor
 * execution candidate. Not a provider SDK or a claim of deployed support.
 * Contract owner: takoform-forms actor-execution-contract.md (43b31a73).
 */
export type ActorSqlValue =
  null | number | string | { encoding: "base64"; data: string };

export interface ActorSqlStatement {
  sql: string;
  params?: readonly ActorSqlValue[];
}

export interface ActorSqlResult {
  rows: readonly Readonly<Record<string, ActorSqlValue>>[];
  rowsWritten: number;
}

export interface ActorSocket {
  readonly id: string;
  send(data: string | Uint8Array): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
  getAttachment(): Promise<Uint8Array | null>;
  setAttachment(value: Uint8Array | null): Promise<void>;
}

export interface ActorContext {
  readonly id: string;
  readonly storage: {
    execute(
      sql: string,
      params?: readonly ActorSqlValue[],
    ): Promise<ActorSqlResult>;
    query(
      sql: string,
      params?: readonly ActorSqlValue[],
    ): Promise<ActorSqlResult>;
    transaction(statements: readonly ActorSqlStatement[]): Promise<{
      results: readonly ActorSqlResult[];
    }>;
  };
  readonly alarm: {
    set(atMillis: number): Promise<void>;
    get(): Promise<number | null>;
    clear(): Promise<void>;
  };
  readonly sockets: {
    accept(
      request: Request,
      options?: { protocol?: string; attachment?: Uint8Array },
    ): Promise<{ response: Response; socket: ActorSocket }>;
    get(id: string): Promise<ActorSocket | null>;
    list(): Promise<readonly ActorSocket[]>;
  };
}

export interface ActorTurn {
  readonly signal: AbortSignal;
}

export interface ActorSocketCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}
