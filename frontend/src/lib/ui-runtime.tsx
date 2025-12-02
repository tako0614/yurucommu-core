import { Component, JSX, For, Show, createSignal, createMemo } from "solid-js";

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
 * Component Registry for UiNode types
 */
type UiComponentProps = {
  node: UiNode;
  context?: Record<string, any>;
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

  // Pass props and rendered children to component
  return <ComponentImpl {...node.props}>{children()}</ComponentImpl>;
};

/**
 * Screen Renderer
 *
 * Renders a Screen definition from App Manifest
 */
export const RenderScreen: Component<{ screen: Screen; context?: Record<string, any> }> = (props) => {
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
