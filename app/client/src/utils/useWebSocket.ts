import { useEffect, useState, useCallback, useRef } from 'react';
import { TakosWebSocketClient, initWebSocketClient, getWebSocketClient } from '../utils/websocket.ts';

export interface UseWebSocketOptions {
  url?: string;
  token?: string;
  autoConnect?: boolean;
  subscriptions?: string[];
}

export interface WebSocketState {
  isConnected: boolean;
  connectionState: string;
  error: string | null;
  lastMessage: any;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url = `ws://${window.location.hostname}:3001/ws/events`,
    token,
    autoConnect = true,
    subscriptions = []
  } = options;

  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    connectionState: 'DISCONNECTED',
    error: null,
    lastMessage: null
  });

  const clientRef = useRef<TakosWebSocketClient | null>(null);
  const eventHandlersRef = useRef(new Map<string, Set<(payload: unknown) => void>>());

  // WebSocketクライアントの初期化
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [url, autoConnect]);

  // トークンが変更された場合の再認証
  useEffect(() => {
    if (clientRef.current && clientRef.current.isConnected() && token) {
      // 再接続して新しいトークンで認証
      connect();
    }
  }, [token]);

  // 購読の更新
  useEffect(() => {
    if (clientRef.current && subscriptions.length > 0) {
      clientRef.current.subscribe(subscriptions);
    }
  }, [subscriptions]);

  // 接続
  const connect = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, error: null }));
      
      if (!clientRef.current) {
        clientRef.current = initWebSocketClient(url);
      }

      await clientRef.current.connect(token);
      
      // 状態更新のためのリスナーを設定
      const updateState = () => {
        if (clientRef.current) {
          setState(prev => ({
            ...prev,
            isConnected: clientRef.current!.isConnected(),
            connectionState: clientRef.current!.getConnectionState()
          }));
        }
      };

      // 定期的に状態を更新
      const interval = setInterval(updateState, 1000);
      
      // クリーンアップ用にintervalを保存
      (clientRef.current as any)._stateInterval = interval;

      updateState();
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Connection failed',
        isConnected: false,
        connectionState: 'DISCONNECTED'
      }));
    }
  }, [url, token]);

  // 切断
  const disconnect = useCallback(() => {
    if (clientRef.current) {
      // 状態更新のintervalをクリア
      if ((clientRef.current as any)._stateInterval) {
        clearInterval((clientRef.current as any)._stateInterval);
      }
      
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    
    setState({
      isConnected: false,
      connectionState: 'DISCONNECTED',
      error: null,
      lastMessage: null
    });
  }, []);

  // イベント購読
  const subscribe = useCallback((events: string[]) => {
    if (clientRef.current) {
      clientRef.current.subscribe(events);
    }
  }, []);

  // イベント購読解除
  const unsubscribe = useCallback((events: string[]) => {
    if (clientRef.current) {
      clientRef.current.unsubscribe(events);
    }
  }, []);

  // イベントハンドラーの追加
  const on = useCallback((eventName: string, handler: (payload: unknown) => void) => {
    if (clientRef.current) {
      clientRef.current.on(eventName, (payload) => {
        setState(prev => ({ ...prev, lastMessage: { eventName, payload } }));
        handler(payload);
      });
    }

    // ローカルの管理用
    if (!eventHandlersRef.current.has(eventName)) {
      eventHandlersRef.current.set(eventName, new Set());
    }
    eventHandlersRef.current.get(eventName)!.add(handler);
  }, []);

  // イベントハンドラーの削除
  const off = useCallback((eventName: string, handler: (payload: unknown) => void) => {
    if (clientRef.current) {
      clientRef.current.off(eventName, handler);
    }

    const handlers = eventHandlersRef.current.get(eventName);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        eventHandlersRef.current.delete(eventName);
      }
    }
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    on,
    off,
    client: clientRef.current
  };
}

// WebSocketイベントを監視するフック
export function useWebSocketEvent<T = unknown>(
  eventName: string,
  handler: (payload: T) => void,
  deps: any[] = []
) {
  const { on, off, isConnected } = useWebSocket({ autoConnect: false });

  useEffect(() => {
    if (isConnected) {
      const wrappedHandler = (payload: unknown) => handler(payload as T);
      on(eventName, wrappedHandler);
      
      return () => {
        off(eventName, wrappedHandler);
      };
    }
  }, [eventName, isConnected, ...deps]);
}

// WebSocketの状態のみを監視するフック
export function useWebSocketState() {
  const client = getWebSocketClient();
  const [state, setState] = useState<WebSocketState>({
    isConnected: client?.isConnected() || false,
    connectionState: client?.getConnectionState() || 'DISCONNECTED',
    error: null,
    lastMessage: null
  });

  useEffect(() => {
    const interval = setInterval(() => {
      if (client) {
        setState(prev => ({
          ...prev,
          isConnected: client.isConnected(),
          connectionState: client.getConnectionState()
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [client]);

  return state;
}
