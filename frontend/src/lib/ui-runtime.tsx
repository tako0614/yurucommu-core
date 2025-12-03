import type { Component, JSX } from "solid-js";
import { For, Show, createMemo, createResource, Suspense } from "solid-js";

/**
 * UiNode Type Definitions (PLAN.md 5.4)
 */
export interface UiNode {
  type: string;
  props?: Record<string, any>;
  children?: UiNode[];
}

export interface Screen {
  id: string;
  route: string;
  title: string;
  layout: UiNode;
}

/**
 * Data Source Definition for API binding
 */
export interface DataSource {
  type: "api" | "static";
  route?: string;
  method?: string;
  path?: string;
  params?: Record<string, string>;
}

/**
 * Runtime Context passed to components
 */
export interface UiRuntimeContext {
  routeParams: Record<string, string>;
  location: string;
  data?: Record<string, any>;
  actions?: Record<string, () => void>;
}

/**
 * Component Registry for UiNode types
 */
type UiComponentProps = {
  node: UiNode;
  context?: UiRuntimeContext;
};

/**
 * Primitive Components
 */
const Column: Component<{ id?: string; gap?: number; flex?: number; slot?: string; children?: JSX.Element }> = (props) => {
  return (
    <div
      id={props.id}
      data-slot={props.slot}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: props.gap ? `${props.gap}px` : undefined,
        flex: props.flex ? `${props.flex}` : undefined,
      }}
    >
      {props.children}
    </div>
  );
};

const Row: Component<{ id?: string; gap?: number; align?: string; slot?: string; children?: JSX.Element }> = (props) => {
  return (
    <div
      id={props.id}
      data-slot={props.slot}
      style={{
        display: "flex",
        "flex-direction": "row",
        gap: props.gap ? `${props.gap}px` : undefined,
        "align-items": props.align === "center" ? "center" : undefined,
      }}
    >
      {props.children}
    </div>
  );
};

const Text: Component<{ text?: string; variant?: string }> = (props) => {
  const variantStyles: Record<string, JSX.CSSProperties> = {
    title: { "font-size": "1.5rem", "font-weight": "bold" },
    subtitle: { "font-size": "1.2rem", "font-weight": "600" },
    body: { "font-size": "1rem" },
  };

  return <span style={variantStyles[props.variant || "body"]}>{props.text}</span>;
};

const Spacer: Component<{ flex?: number }> = (props) => {
  return <div style={{ flex: props.flex || 1 }} />;
};

const Placeholder: Component<{ text?: string }> = (props) => {
  return (
    <div
      style={{
        padding: "16px",
        border: "2px dashed #ccc",
        "border-radius": "8px",
        "text-align": "center",
        color: "#666",
      }}
    >
      {props.text || "Placeholder"}
    </div>
  );
};

const Button: Component<{ text?: string; onClick?: () => void; variant?: string }> = (props) => {
  const variantStyles: Record<string, JSX.CSSProperties> = {
    primary: {
      background: "#007bff",
      color: "white",
      border: "none",
      padding: "8px 16px",
      "border-radius": "4px",
      cursor: "pointer",
    },
    secondary: {
      background: "#6c757d",
      color: "white",
      border: "none",
      padding: "8px 16px",
      "border-radius": "4px",
      cursor: "pointer",
    },
  };

  return (
    <button style={variantStyles[props.variant || "primary"]} onClick={props.onClick}>
      {props.text || "Button"}
    </button>
  );
};

const Input: Component<{ placeholder?: string; value?: string; onChange?: (value: string) => void }> = (props) => {
  return (
    <input
      type="text"
      placeholder={props.placeholder}
      value={props.value}
      onInput={(e) => props.onChange?.(e.currentTarget.value)}
      style={{
        padding: "8px",
        border: "1px solid #ccc",
        "border-radius": "4px",
        width: "100%",
      }}
    />
  );
};

/**
 * Card Component - displays content in a card container
 */
const Card: Component<{ id?: string; padding?: number; shadow?: boolean; children?: JSX.Element }> = (props) => {
  return (
    <div
      id={props.id}
      style={{
        padding: props.padding ? `${props.padding}px` : "16px",
        background: "white",
        "border-radius": "8px",
        "box-shadow": props.shadow !== false ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
        border: "1px solid #e5e7eb",
      }}
    >
      {props.children}
    </div>
  );
};

/**
 * Image Component - displays an image
 */
const Image: Component<{ src?: string; alt?: string; width?: number | string; height?: number | string; rounded?: boolean }> = (props) => {
  return (
    <img
      src={props.src}
      alt={props.alt || ""}
      style={{
        width: typeof props.width === "number" ? `${props.width}px` : props.width,
        height: typeof props.height === "number" ? `${props.height}px` : props.height,
        "border-radius": props.rounded ? "50%" : undefined,
        "object-fit": "cover",
      }}
    />
  );
};

/**
 * Link Component - clickable link with routing support
 */
const Link: Component<{ href?: string; text?: string; children?: JSX.Element }> = (props) => {
  return (
    <a
      href={props.href}
      style={{
        color: "#3b82f6",
        "text-decoration": "none",
      }}
    >
      {props.children || props.text}
    </a>
  );
};

/**
 * Divider Component - horizontal separator
 */
const Divider: Component<{ margin?: number }> = (props) => {
  const m = props.margin ?? 16;
  return (
    <hr
      style={{
        border: "none",
        "border-top": "1px solid #e5e7eb",
        margin: `${m}px 0`,
      }}
    />
  );
};

/**
 * Badge Component - small label/tag
 */
const Badge: Component<{ text?: string; variant?: "default" | "primary" | "success" | "warning" | "error" }> = (props) => {
  const colors: Record<string, { bg: string; text: string }> = {
    default: { bg: "#e5e7eb", text: "#374151" },
    primary: { bg: "#dbeafe", text: "#1d4ed8" },
    success: { bg: "#dcfce7", text: "#15803d" },
    warning: { bg: "#fef3c7", text: "#b45309" },
    error: { bg: "#fee2e2", text: "#b91c1c" },
  };
  const c = colors[props.variant || "default"];
  return (
    <span
      style={{
        padding: "2px 8px",
        "border-radius": "9999px",
        "font-size": "0.75rem",
        background: c.bg,
        color: c.text,
      }}
    >
      {props.text}
    </span>
  );
};

/**
 * Icon Component - displays an icon (using text-based icons for simplicity)
 */
const Icon: Component<{ name?: string; size?: number }> = (props) => {
  const icons: Record<string, string> = {
    home: "🏠",
    user: "👤",
    settings: "⚙️",
    message: "💬",
    notification: "🔔",
    search: "🔍",
    plus: "➕",
    close: "✕",
    check: "✓",
    arrow_right: "→",
    arrow_left: "←",
  };
  return (
    <span style={{ "font-size": props.size ? `${props.size}px` : "1rem" }}>
      {icons[props.name || ""] || props.name}
    </span>
  );
};

/**
 * ApiData Component - fetches data from API and renders children with data context
 */
const ApiData: Component<{
  source?: DataSource;
  path?: string;
  method?: string;
  children?: JSX.Element;
}> = (props) => {
  const [data] = createResource(
    () => ({ path: props.source?.path || props.path, method: props.source?.method || props.method || "GET" }),
    async (params) => {
      if (!params.path) return null;
      try {
        const response = await fetch(params.path, { method: params.method });
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        return response.json();
      } catch (err) {
        console.error("[ApiData] Fetch error:", err);
        return null;
      }
    }
  );

  return (
    <Suspense fallback={<div style={{ padding: "8px", color: "#6b7280" }}>Loading...</div>}>
      <Show when={data()} fallback={<div style={{ color: "#ef4444" }}>Failed to load data</div>}>
        {props.children}
      </Show>
    </Suspense>
  );
};

/**
 * ApiList Component - fetches list data and renders items
 */
const ApiList: Component<{
  source?: DataSource;
  path?: string;
  itemTemplate?: UiNode;
  emptyText?: string;
  children?: JSX.Element;
}> = (props) => {
  const [items] = createResource(
    () => props.source?.path || props.path,
    async (path) => {
      if (!path) return [];
      try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();
        return Array.isArray(data) ? data : data.items || data.data || [];
      } catch (err) {
        console.error("[ApiList] Fetch error:", err);
        return [];
      }
    }
  );

  return (
    <Suspense fallback={<div style={{ padding: "8px", color: "#6b7280" }}>Loading...</div>}>
      <Show
        when={items() && items()!.length > 0}
        fallback={<div style={{ padding: "16px", color: "#6b7280", "text-align": "center" }}>{props.emptyText || "No items"}</div>}
      >
        <For each={items()}>
          {(item) => (
            <div data-item={JSON.stringify(item)}>
              {props.children}
            </div>
          )}
        </For>
      </Show>
    </Suspense>
  );
};

/**
 * Component Registry
 */
const componentRegistry: Record<string, Component<any>> = {
  Column,
  Row,
  Text,
  Spacer,
  Placeholder,
  Button,
  Input,
  Card,
  Image,
  Link,
  Divider,
  Badge,
  Icon,
  ApiData,
  ApiList,
};

/**
 * Register a custom UiNode component
 */
export function registerUiComponent(type: string, component: Component<any>) {
  componentRegistry[type] = component;
}

/**
 * UiNode Renderer
 *
 * Recursively renders UiNode tree into SolidJS components
 * (PLAN.md 5.4: App Manifest / UiNode 駆動 UI)
 */
export const RenderUiNode: Component<UiComponentProps> = (props) => {
  const { node, context } = props;

  const ComponentImpl = componentRegistry[node.type];

  if (!ComponentImpl) {
    console.warn(`[UiRuntime] Unknown UiNode type: ${node.type}`);
    return <div style={{ color: "red" }}>Unknown component: {node.type}</div>;
  }

  // Render children recursively
  const children = createMemo(() => {
    if (!node.children || node.children.length === 0) return null;
    return (
      <For each={node.children}>
        {(child) => <RenderUiNode node={child} context={context} />}
      </For>
    );
  });

  // Pass props, context, and rendered children to component
  return <ComponentImpl {...node.props} context={context}>{children()}</ComponentImpl>;
};

/**
 * Screen Renderer
 *
 * Renders a Screen definition from App Manifest
 */
export const RenderScreen: Component<{ screen: Screen; context?: UiRuntimeContext }> = (props) => {
  return (
    <div data-screen-id={props.screen.id} data-screen-route={props.screen.route}>
      <RenderUiNode node={props.screen.layout} context={props.context} />
    </div>
  );
};

/**
 * App Manifest Loader (stub)
 *
 * In production, this would fetch from `/-/app/manifest` endpoint
 */
export async function loadAppManifest(): Promise<{ screens: Screen[] }> {
  // TODO: Fetch from backend API
  // const response = await fetch("/-/app/manifest");
  // return response.json();

  // For now, return empty manifest (will be populated by actual implementation)
  return { screens: [] };
}

/**
 * Get screen by route
 */
export function getScreenByRoute(screens: Screen[], route: string): Screen | undefined {
  // Exact match
  const exact = screens.find((s) => s.route === route);
  if (exact) return exact;

  // Pattern match (e.g., /communities/:id)
  return screens.find((s) => {
    const pattern = s.route.replace(/:\w+/g, "[^/]+");
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(route);
  });
}

/**
 * Extract route params from pattern
 */
export function extractRouteParams(pattern: string, route: string): Record<string, string> {
  const patternParts = pattern.split("/");
  const routeParts = route.split("/");
  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      const key = patternParts[i].slice(1);
      params[key] = routeParts[i];
    }
  }

  return params;
}
