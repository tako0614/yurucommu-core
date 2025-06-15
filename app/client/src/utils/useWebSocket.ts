import { createSignal, createEffect, onCleanup, Accessor } from 'solid-js';
// Ensure your import path is correct for your project structure.
// Typically, you wouldn't include the .ts extension in the import path.
import { TakosWebSocketClient, initWebSocketClient, getWebSocketClient } from './websocket.ts';

export interface UseWebSocketOptions {
    url?: string | Accessor<string | undefined>;
    token?: string | Accessor<string | undefined>;
    autoConnect?: boolean | Accessor<boolean | undefined>;
    subscriptions?: string[] | Accessor<string[] | undefined>;
}

export interface WebSocketState {
    isConnected: boolean;
    connectionState: string;
    error: string | null;
    lastMessage: { eventName: string; payload: unknown } | null; // More specific type
}

// Helper to resolve option values, which might be accessors
const getOption = <T>(value: T | Accessor<T | undefined>, defaultValue?: T): T | undefined => {
    if (typeof value === 'function' && value.length === 0) {
        const accessor = value as Accessor<T | undefined>;
        const result = accessor();
        return result === undefined ? defaultValue : result;
    }
    return value === undefined ? defaultValue : value as T;
};


export function useWebSocket(optionsArg: UseWebSocketOptions = {}) {
    const [state, setState] = createSignal<WebSocketState>({
        isConnected: false,
        connectionState: 'DISCONNECTED',
        error: null,
        lastMessage: null,
    });

    const [getClient, setClient] = createSignal<TakosWebSocketClient | null>(null);
    // Stores original handlers provided by the user
    const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
    // Stores wrapped handlers used for client.on/off to manage lastMessage update
    const clientEventWrappers = new Map<string, Map<(payload: unknown) => void, (payload: unknown) => void>>();
    let stateUpdateIntervalId: ReturnType<typeof setInterval> | undefined;
    const connect = async () => {
        const currentUrl = getOption(optionsArg.url, `ws://${globalThis.location?.hostname || 'localhost'}:3001/ws/events`)!;
        const currentToken = getOption(optionsArg.token);

        setState(prev => ({ ...prev, error: null, connectionState: 'CONNECTING' }));

        if (stateUpdateIntervalId) {
            clearInterval(stateUpdateIntervalId);
            stateUpdateIntervalId = undefined;
        }

        let client = getClient();
        let isNewClientInstance = false;        // If client exists but URL changed, re-initialize
        if (client) {
            // For now, we always recreate the client when reconnecting
            // In production, you might want to check if URL actually changed
            client.disconnect();
            setClient(null);
            client = null;
        }        if (!client) {
            client = initWebSocketClient(currentUrl);
            setClient(client);
            isNewClientInstance = true;
        }
        
        try {
            await client.connect(currentToken);

            if (isNewClientInstance) {
                // Re-apply stored event handlers to the new client instance
                for (const [eventName, handlerMap] of clientEventWrappers) {
                    for (const wrappedHandler of handlerMap.values()) {
                        // Note: original handler is key in handlerMap, wrappedHandler is value
                        client.on(eventName, wrappedHandler);
                    }
                }
            }
            
            const updateState = () => {
                const c = getClient();
                if (c) {
                    setState(prev => ({
                        ...prev,
                        isConnected: c.isConnected(),
                        connectionState: c.getConnectionState(),
                    }));
                }
            };
            stateUpdateIntervalId = setInterval(updateState, 1000);
            updateState(); // Initial update

            const currentSubscriptions = getOption(optionsArg.subscriptions, []);
            if (client.isConnected() && currentSubscriptions && currentSubscriptions.length > 0) {
                client.subscribe(currentSubscriptions);
            }
            if (client.isConnected()) {
                 setState(prev => ({ ...prev, connectionState: client!.getConnectionState(), isConnected: true, error: null }));
            }

        } catch (error) {
            setState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Connection failed',
                isConnected: false,
                connectionState: 'DISCONNECTED',
            }));
        }
    };

    const disconnect = () => {
        if (stateUpdateIntervalId) {
            clearInterval(stateUpdateIntervalId);
            stateUpdateIntervalId = undefined;
        }
        const client = getClient();
        if (client) {
            client.disconnect();
            setClient(null);
        }
        setState({
            isConnected: false,
            connectionState: 'DISCONNECTED',
            error: null,
            lastMessage: null,
        });
    };

    createEffect(() => {
        const shouldConnect = getOption(optionsArg.autoConnect, true);
        getOption(optionsArg.url); // Track URL for changes

        if (shouldConnect) {
            connect();
        }
        onCleanup(() => {
            disconnect();
        });
    });

    createEffect(() => {
        const currentToken = getOption(optionsArg.token);
        const client = getClient();
        if (client && client.isConnected() && currentToken !== undefined) {
            // Assuming connect() handles re-authentication if called with a new token
            connect();
        }
    });

    createEffect(() => {
        const currentSubscriptions = getOption(optionsArg.subscriptions, []);
        const client = getClient();
        if (client && state().isConnected && currentSubscriptions && currentSubscriptions.length > 0) {
            client.subscribe(currentSubscriptions);
        }
    });

    const on = (eventName: string, handler: (payload: unknown) => void) => {
        const wrappedClientHandler = (payload: unknown) => {
                setState(prev => ({ ...prev, lastMessage: { eventName, payload } }));
                handler(payload);
        };

        const client = getClient();
        if (client) {
                client.on(eventName, wrappedClientHandler);
        }

        if (!eventHandlers.has(eventName)) {
                eventHandlers.set(eventName, new Set());
                clientEventWrappers.set(eventName, new Map());
        }
        eventHandlers.get(eventName)!.add(handler);
        clientEventWrappers.get(eventName)!.set(handler, wrappedClientHandler);
    };

    const off = (eventName: string, handler: (payload: unknown) => void) => {
        const client = getClient();
        const wrappedHandler = clientEventWrappers.get(eventName)?.get(handler);

        if (client && wrappedHandler) {
                client.off(eventName, wrappedHandler);
        }

        const handlersSet = eventHandlers.get(eventName);
        if (handlersSet) {
                handlersSet.delete(handler);
                clientEventWrappers.get(eventName)?.delete(handler);
                if (handlersSet.size === 0) {
                        eventHandlers.delete(eventName);
                        clientEventWrappers.delete(eventName);
                }
        }
    };

    const subscribe = (events: string[]) => {
        const client = getClient();
        if (client && state().isConnected) {
            client.subscribe(events);
        }
    };

    const unsubscribe = (events: string[]) => {
        const client = getClient();
        if (client && state().isConnected) {
            client.unsubscribe(events);
        }
    };

    return {
        isConnected: () => state().isConnected,
        connectionState: () => state().connectionState,
        error: () => state().error,
        lastMessage: () => state().lastMessage,
        connect,
        disconnect,
        subscribe,
        unsubscribe,
        on,
        off,
        client: getClient, // Exposes the client signal getter
    };
}

export function useWebSocketEvent<T = unknown>(
    eventName: string | Accessor<string>,
    handler: (payload: T) => void,
    customDeps: Accessor<unknown>[] = [] // Changed from any to unknown
) {
    // This hook creates its own WebSocket management instance.
    // This is generally okay if `initWebSocketClient` is a singleton factory for a given URL,
    // and `TakosWebSocketClient` allows multiple managers for its events.
    // `autoConnect: false` means this hook relies on another `useWebSocket` call (e.g. global)
    // to actually establish the connection.
    const { on, off, isConnected } = useWebSocket({ autoConnect: false });

    createEffect(() => {
        const currentEventName = getOption(eventName)!; // eventName should always be provided
        
        // Track custom dependencies by accessing them
        for (const dep of customDeps) {
            dep();
        }

        if (isConnected()) {
            const wrappedHandler = (payload: unknown) => handler(payload as T);
            on(currentEventName, wrappedHandler);
            
            onCleanup(() => {
                off(currentEventName, wrappedHandler);
            });
        }
    });
}

// Renamed to avoid conflict with the WebSocketState interface
export function useWebSocketStateHook() {
    const [state, setState] = createSignal<WebSocketState>({
        isConnected: getWebSocketClient()?.isConnected() || false,
        connectionState: getWebSocketClient()?.getConnectionState() || 'DISCONNECTED',
        error: null,
        lastMessage: null,
    });

    createEffect(() => {
        const client = getWebSocketClient();

        if (!client) {
            setState({
                isConnected: false,
                connectionState: 'DISCONNECTED',
                error: null,
                lastMessage: null,
            });
            return;
        }

        const intervalId = setInterval(() => {
            setState(prev => ({
                ...prev,
                isConnected: client.isConnected(),
                connectionState: client.getConnectionState(),
            }));
        }, 1000);

        onCleanup(() => clearInterval(intervalId));
    });

    return {
        isConnected: () => state().isConnected,
        connectionState: () => state().connectionState,
        error: () => state().error,
        lastMessage: () => state().lastMessage,
    };
}
