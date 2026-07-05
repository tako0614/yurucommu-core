export interface ApiTransport {
  resolveUrl(path: string): string;
  getAuthHeaders(path: string): Record<string, string>;
  readonly credentials: RequestCredentials;
}

class DefaultSelfHostedTransport implements ApiTransport {
  readonly credentials: RequestCredentials = "include";

  resolveUrl(path: string): string {
    return path;
  }

  getAuthHeaders(_path: string): Record<string, string> {
    return {};
  }
}

export type ApiTransportResolver = () => ApiTransport;

let activeTransportResolver: ApiTransportResolver = () =>
  new DefaultSelfHostedTransport();

export function setYurucommuApiTransportResolver(
  resolver: ApiTransportResolver,
): void {
  activeTransportResolver = resolver;
}

export function setYurucommuApiTransport(transport: ApiTransport): void {
  activeTransportResolver = () => transport;
}

export function clearYurucommuApiTransport(): void {
  activeTransportResolver = () => new DefaultSelfHostedTransport();
}

export function getYurucommuApiTransport(): ApiTransport {
  return activeTransportResolver();
}
