import type { Accessor, Component, JSX } from "solid-js";
import {
  For,
  Show,
  Suspense,
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  useContext,
} from "solid-js";
import { createStore } from "solid-js/store";
import { useNavigate } from "@solidjs/router";
import { api, getBackendUrl, getJWT } from "./api";

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
  state?: Record<string, { default: any }>;
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

export type TableColumnDef = {
  key: string;
  label: string;
  width?: number | string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
};

/**
 * Runtime Context passed to components
 */
export interface UiRuntimeContext {
  routeParams?: Record<string, string>;
  location?: string;
  data?: Record<string, any>;
  item?: any;
  list?: any[];
  actions?: Record<string, () => void>;
  state?: Record<string, any>;
  setState?: (key: string, value: any) => void;
  form?: { values: Record<string, any> };
  navigate?: (to: string, options?: { replace?: boolean }) => void;
  refresh?: (target?: string | string[]) => void;
  registerRefetch?: (id: string, handler: () => void) => () => void;
  tableColumns?: TableColumnDef[];
}

type FieldValidation = {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  maxFiles?: number;
  maxSizeMB?: number;
};

type FormContextValue = {
  values: Accessor<Record<string, any>>;
  errors: Accessor<Record<string, string | undefined>>;
  submitting: Accessor<boolean>;
  registerField: (name: string, initialValue?: any, validation?: FieldValidation) => void;
  unregisterField: (name: string) => void;
  updateValue: (name: string, value: any, validation?: FieldValidation) => void;
  setFieldError: (name: string, message?: string) => void;
  validateField: (name: string, validation?: FieldValidation) => boolean;
};

const FormContext = createContext<FormContextValue>();

function useFormContext(): FormContextValue | undefined {
 return useContext(FormContext);
}

/**
 * Component Registry for UiNode types
 */
type UiComponentProps = {
  node: UiNode;
  context?: UiRuntimeContext;
  renderChildren?: (overrideContext?: Partial<UiRuntimeContext>, explicitChildren?: UiNode[]) => JSX.Element | null;
};

type SetStateActionConfig = {
  type: "setState";
  key: string;
  value?: any;
};

type NavigateActionConfig = {
  type: "navigate";
  to: string;
  replace?: boolean;
};

type ApiActionConfig = {
  type: "api";
  method?: string;
  endpoint: string;
  query?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
  onSuccess?: ActionConfig | ActionConfig[];
  onError?: ActionConfig | ActionConfig[];
  refresh?: string | string[];
};

type RefreshActionConfig = {
  type: "refresh";
  target?: string | string[];
};

type SequenceActionConfig = {
  type: "sequence";
  actions: ActionConfig[];
};

type NamedActionConfig = {
  type: "action";
  name: string;
};

type ActionConfig = SetStateActionConfig | NavigateActionConfig | ApiActionConfig | RefreshActionConfig | SequenceActionConfig | NamedActionConfig;
type ActionLike = ActionConfig | ActionConfig[] | string | ((payload?: any) => void | Promise<void>);

const templatePattern = /\{\{\s*([^}]+)\s*\}\}/g;

const isPlainObject = (value: any): value is Record<string, any> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const isStateRef = (value: any): value is { $state: string } => {
  return isPlainObject(value) && typeof value.$state === "string";
};

const isSetStateAction = (value: any): value is SetStateActionConfig => {
  return isPlainObject(value) && value.type === "setState" && typeof value.key === "string";
};

const ACTION_TYPES = new Set(["navigate", "api", "refresh", "sequence", "action"]);

const isActionConfig = (value: any): value is ActionConfig => {
  return isPlainObject(value) && typeof value.type === "string" && ACTION_TYPES.has(value.type);
};

const isActionArray = (value: any): value is ActionConfig[] => {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isActionConfig(item) || isSetStateAction(item));
};

const isFormRef = (value: any): value is { $form: true } => {
  return isPlainObject(value) && value.$form === true;
};

const readContextPath = (context: UiRuntimeContext | undefined, path: string) => {
  if (!context) return undefined;
  const parts = path.split(".");
  let current: any = { ...context };
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
};

const resolveTemplateString = (value: string, context?: UiRuntimeContext) => {
  if (!context) return value;
  const exactMatch = value.match(/^\s*\{\{\s*([^}]+)\s*\}\}\s*$/);
  if (exactMatch) {
    const resolved = readContextPath(context, exactMatch[1].trim());
    return resolved === undefined ? "" : resolved;
  }
  return value.replace(templatePattern, (_, expr: string) => {
    const resolved = readContextPath(context, expr.trim());
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
};

const extractPayloadValue = (payload: any) => {
  if (payload && typeof payload === "object") {
    const target: any = (payload as any).currentTarget || (payload as any).target;
    if (target && "value" in target) {
      return target.value;
    }
  }
  return payload;
};

const resolveValue = (value: any, context?: UiRuntimeContext, options?: { preserveActions?: boolean }): any => {
  if (isActionArray(value) && !options?.preserveActions) {
    return buildActionHandler({ type: "sequence", actions: value }, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, context, options));
  }

  if (isStateRef(value)) {
    return context?.state ? (context.state as any)[value.$state] : undefined;
  }

  if (!options?.preserveActions && isSetStateAction(value)) {
    return buildSetStateHandler(value, context);
  }

  if (!options?.preserveActions && isActionConfig(value)) {
    return buildActionHandler(value, context);
  }

  if (isFormRef(value)) {
    return context?.form?.values ?? {};
  }

  if (isPlainObject(value)) {
    const resolved: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = resolveValue(val, context, options);
    }
    return resolved;
  }

  if (typeof value === "string") {
    return resolveTemplateString(value, context);
  }

  return value;
};

function buildSetStateHandler(action: SetStateActionConfig, context?: UiRuntimeContext) {
  return (payload?: any) => {
    if (!context?.setState) {
      console.warn("[UiRuntime] setState action called without context", action);
      return;
    }
    if (!context.state || !(action.key in context.state)) {
      console.warn(`[UiRuntime] setState target '${action.key}' is not declared on this Screen`);
    }
    const nextValue = Object.prototype.hasOwnProperty.call(action, "value")
      ? resolveValue(action.value, context, { preserveActions: true })
      : extractPayloadValue(payload);
    context.setState(action.key, nextValue);
  };
}

function buildActionHandler(action: ActionConfig, context?: UiRuntimeContext) {
  if (isSetStateAction(action)) {
    const handler = buildSetStateHandler(action, context);
    return (payload?: any) => handler(payload);
  }
  return async (payload?: any) => {
    try {
      await executeAction(action, context, payload);
    } catch (err) {
      console.error("[UiRuntime] Action execution failed:", err);
    }
  };
}

function normalizeActionHandler(action: ActionLike | undefined, context?: UiRuntimeContext) {
  if (!action) return undefined;
  if (typeof action === "function") {
    return action;
  }
  if (typeof action === "string") {
    const fn = context?.actions?.[action];
    if (!fn) {
      console.warn(`[UiRuntime] Named action '${action}' not found in context`);
      return undefined;
    }
    return fn;
  }
  if (Array.isArray(action)) {
    const valid = action.every((item) => isActionConfig(item) || isSetStateAction(item));
    if (!valid) return undefined;
    return buildActionHandler({ type: "sequence", actions: action as ActionConfig[] }, context);
  }
  if (isSetStateAction(action)) {
    return buildSetStateHandler(action, context);
  }
  if (isActionConfig(action)) {
    return buildActionHandler(action, context);
  }
  return undefined;
}

function appendFormData(formData: FormData, key: string, value: any) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item) => appendFormData(formData, key, item));
    return;
  }
  formData.append(key, value);
}

function containsFileLike(value: any): boolean {
  const isFileLike = (val: any) => {
    if (typeof File !== "undefined" && val instanceof File) return true;
    if (typeof Blob !== "undefined" && val instanceof Blob) return true;
    return false;
  };
  if (isFileLike(value)) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsFileLike(item));
  }
  if (isPlainObject(value)) {
    return Object.values(value).some((item) => containsFileLike(item));
  }
  return false;
}

function buildApiUrl(endpoint: string, query?: Record<string, any>) {
  const base = endpoint?.startsWith("http") ? endpoint : `${getBackendUrl() || ""}${endpoint || ""}`;
  if (!query || typeof query !== "object") {
    return base;
  }
  const search = new URLSearchParams();
  const appendParam = (key: string, value: any) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v) => appendParam(key, v));
      return;
    }
    search.append(key, String(value));
  };
  Object.entries(query).forEach(([key, value]) => appendParam(key, value));
  const qs = search.toString();
  if (!qs) return base;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${qs}`;
}

async function executeApiAction(action: ApiActionConfig, context?: UiRuntimeContext, payload?: any) {
  const endpoint = resolveValue(action.endpoint, context, { preserveActions: true });
  if (typeof endpoint !== "string" || !endpoint) {
    console.warn("[UiRuntime] api action requires endpoint");
    return;
  }

  const method = (action.method || "GET").toUpperCase();
  const query = action.query ? resolveValue(action.query, context, { preserveActions: true }) : undefined;
  const headers = (resolveValue(action.headers || {}, context, { preserveActions: true }) || {}) as Record<string, string>;

  let body = action.body !== undefined ? resolveValue(action.body, context, { preserveActions: true }) : payload;

  const url = buildApiUrl(endpoint, query);

  const requestInit: RequestInit = {
    method,
    headers: { ...headers },
    credentials: "include",
  };

  const headerRecord = requestInit.headers as Record<string, string>;
  const jwt = getJWT();
  if (jwt && !headerRecord["Authorization"]) {
    headerRecord["Authorization"] = `Bearer ${jwt}`;
  }

  if (method !== "GET" && body !== undefined && body !== null) {
    if (body instanceof FormData) {
      requestInit.body = body;
      delete headerRecord["Content-Type"];
    } else if (containsFileLike(body)) {
      const formData = new FormData();
      Object.entries(body as Record<string, any>).forEach(([key, value]) => appendFormData(formData, key, value));
      requestInit.body = formData;
      delete headerRecord["Content-Type"];
    } else {
      requestInit.body = typeof body === "string" ? body : JSON.stringify(body);
      if (!headerRecord["Content-Type"]) {
        headerRecord["Content-Type"] = "application/json";
      }
    }
  }

  try {
    const response = await fetch(url, requestInit);
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok === false) {
      throw new Error(json?.error || `HTTP ${response.status}`);
    }
    const result = json?.data ?? json;
    if (action.onSuccess) {
      const handler = normalizeActionHandler(action.onSuccess, context);
      if (handler) {
        await handler(result);
      }
    }
    if (action.refresh) {
      context?.refresh?.(action.refresh);
    }
    return result;
  } catch (err) {
    console.error("[UiRuntime] API action failed:", err);
    if (action.onError) {
      const handler = normalizeActionHandler(action.onError, context);
      if (handler) {
        await handler(err);
      }
    }
    return;
  }
}

async function executeAction(action: ActionConfig, context?: UiRuntimeContext, payload?: any): Promise<any> {
  if (isSetStateAction(action)) {
    return buildSetStateHandler(action, context)(payload);
  }

  switch (action.type) {
    case "navigate": {
      const target = resolveValue(action.to, context, { preserveActions: true });
      if (typeof target !== "string" || !target) {
        console.warn("[UiRuntime] navigate action missing destination");
        return;
      }
      if (context?.navigate) {
        context.navigate(target, { replace: action.replace });
      } else if (typeof window !== "undefined") {
        if (action.replace) {
          window.location.replace(target);
        } else {
          window.location.assign(target);
        }
      }
      return;
    }
    case "api":
      return executeApiAction(action, context, payload);
    case "refresh":
      if (context?.refresh) {
        context.refresh(action.target);
      } else if (typeof window !== "undefined") {
        window.location.reload();
      }
      return;
    case "sequence": {
      const steps = action.actions || [];
      for (const step of steps) {
        await executeAction(step, context, payload);
      }
      return;
    }
    case "action": {
      const fn = action.name ? context?.actions?.[action.name] : undefined;
      if (fn) {
        return fn();
      }
      console.warn(`[UiRuntime] Named action '${action.name}' not found`);
      return;
    }
    default:
      console.warn("[UiRuntime] Unknown action type:", (action as any)?.type);
      return;
  }
}

function validateValue(value: any, validation?: FieldValidation): string | undefined {
  if (!validation) return undefined;

  if (validation.required) {
    const isEmpty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (isEmpty) return "This field is required";
  }

  if (typeof value === "string") {
    if (validation.minLength && value.length < validation.minLength) {
      return `Minimum length is ${validation.minLength}`;
    }
    if (validation.maxLength && value.length > validation.maxLength) {
      return `Maximum length is ${validation.maxLength}`;
    }
    if (validation.pattern) {
      try {
        const regex = new RegExp(validation.pattern);
        if (!regex.test(value)) {
          return "Invalid format";
        }
      } catch {
        // Ignore invalid regex
      }
    }
  }

  if (Array.isArray(value)) {
    if (validation.maxFiles && value.length > validation.maxFiles) {
      return `Maximum ${validation.maxFiles} files allowed`;
    }
    if (validation.maxSizeMB) {
      const limit = validation.maxSizeMB * 1024 * 1024;
      const tooLarge = value.some((item) => {
        if (typeof File !== "undefined" && item instanceof File) {
          return item.size > limit;
        }
        if (typeof Blob !== "undefined" && item instanceof Blob) {
          return item.size > limit;
        }
        return false;
      });
      if (tooLarge) {
        return `Each file must be under ${validation.maxSizeMB}MB`;
      }
    }
  }

  return undefined;
}

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

type ButtonProps = {
  text?: string;
  onClick?: () => void;
  action?: ActionLike;
  context?: UiRuntimeContext;
  variant?: "primary" | "secondary";
  submit?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  loadingText?: string;
  loading?: boolean;
};

const Button: Component<ButtonProps> = (props) => {
  const form = useFormContext();
  const isSubmitting = () => (props.submit && form?.submitting ? form.submitting() : false);
  const label = () => {
    if (isSubmitting() && props.loadingText) {
      return props.loadingText;
    }
    return props.text || "Button";
  };

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

  const clickHandler = () => {
    if (props.submit) return;
    const handler = normalizeActionHandler(props.onClick || props.action, props.context);
    handler?.();
  };

  return (
    <button
      type={props.submit ? "submit" : "button"}
      disabled={props.disabled || isSubmitting() || props.loading}
      style={{
        ...variantStyles[props.variant || "primary"],
        opacity: props.disabled || isSubmitting() || props.loading ? 0.7 : 1,
        width: props.fullWidth ? "100%" : undefined,
      }}
      onClick={clickHandler}
    >
      {label()}
    </button>
  );
};

const Input: Component<{
  name?: string;
  type?: string;
  placeholder?: string;
  value?: string | number;
  bind?: string;
  context?: UiRuntimeContext;
  onChange?: (value: string) => void;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  disabled?: boolean;
}> = (props) => {
  const form = useFormContext();
  const validation = () => ({
    required: props.required,
    minLength: props.minLength,
    maxLength: props.maxLength,
    pattern: props.pattern,
  });

  createEffect(() => {
    if (form && props.name) {
      form.registerField(props.name, props.value ?? "", validation());
      onCleanup(() => form.unregisterField(props.name!));
    }
  });

  const resolvedValue = () => {
    if (form && props.name) {
      return form.values()[props.name];
    }
    if (props.value !== undefined) return props.value;
    if (props.bind && props.context?.state) {
      return (props.context.state as any)[props.bind];
    }
    return "";
  };

  const handleChange = (next: string) => {
    props.onChange?.(next);
    if (form && props.name) {
      form.updateValue(props.name, next, validation());
      return;
    }
    if (props.bind && props.context?.setState) {
      props.context.setState(props.bind, next);
    }
  };

  const errorMessage = () => (form && props.name ? form.errors()[props.name] : undefined);

  return (
    <div>
      <input
        type={props.type || "text"}
        placeholder={props.placeholder}
        value={resolvedValue() ?? ""}
        disabled={props.disabled || form?.submitting?.()}
        onInput={(e) => handleChange(e.currentTarget.value)}
        style={{
          padding: "8px",
          border: `1px solid ${errorMessage() ? "#ef4444" : "#ccc"}`,
          "border-radius": "4px",
          width: "100%",
        }}
      />
      <Show when={errorMessage()}>
        <div style={{ color: "#ef4444", "font-size": "0.875rem", "margin-top": "4px" }}>{errorMessage()}</div>
      </Show>
    </div>
  );
};

const Form: Component<{
  id?: string;
  gap?: number;
  onSubmit?: ActionLike;
  action?: ActionLike;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const [values, setValues] = createStore<Record<string, any>>({});
  const [errors, setErrors] = createStore<Record<string, string | undefined>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const validations = new Map<string, FieldValidation | undefined>();

  const registerField = (name: string, initialValue?: any, validation?: FieldValidation) => {
    if (!(name in values)) {
      setValues(name as any, () => initialValue ?? "");
    }
    if (validation) {
      validations.set(name, validation);
    }
  };

  const unregisterField = (name: string) => {
    validations.delete(name);
    setErrors(name as any, undefined as any);
  };

  const validateField = (name: string, validation?: FieldValidation) => {
    const rule = validation ?? validations.get(name);
    if (!rule) {
      setErrors(name as any, undefined as any);
      return true;
    }
    const message = validateValue(values[name], rule);
    if (message) {
      setErrors(name as any, () => message);
      return false;
    }
    setErrors(name as any, undefined as any);
    return true;
  };

  const updateValue = (name: string, value: any, validation?: FieldValidation) => {
    setValues(name as any, () => value);
    validateField(name, validation);
  };

  const setFieldError = (name: string, message?: string) => {
    if (!message) {
      setErrors(name as any, undefined as any);
    } else {
      setErrors(name as any, () => message);
    }
  };

  const validateAll = () => {
    let ok = true;
    validations.forEach((rule, key) => {
      if (!validateField(key, rule)) {
        ok = false;
      }
    });
    return ok;
  };

  const handleSubmit = async (ev: Event) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (!validateAll()) return;
    const handler = normalizeActionHandler(props.onSubmit || props.action, { ...(props.context || {}), form: { values } });
    if (!handler) return;
    setSubmitting(true);
    try {
      await handler({ ...values });
    } finally {
      setSubmitting(false);
    }
  };

  const formContext: FormContextValue = {
    values: () => values,
    errors: () => errors,
    submitting,
    registerField,
    unregisterField,
    updateValue,
    setFieldError,
    validateField,
  };

  const renderBody = () => {
    const childContext = { ...(props.context || {}), form: { values } };
    if (props.renderChildren) {
      return props.renderChildren(childContext);
    }
    return props.children;
  };

  return (
    <FormContext.Provider value={formContext}>
      <form
        id={props.id}
        onSubmit={handleSubmit}
        style={{ display: "grid", gap: props.gap ? `${props.gap}px` : "12px" }}
      >
        {renderBody()}
      </form>
    </FormContext.Provider>
  );
};

const TextArea: Component<{
  name?: string;
  placeholder?: string;
  value?: string;
  bind?: string;
  context?: UiRuntimeContext;
  onChange?: (value: string) => void;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  rows?: number;
}> = (props) => {
  const form = useFormContext();
  const validation = () => ({
    required: props.required,
    minLength: props.minLength,
    maxLength: props.maxLength,
  });

  createEffect(() => {
    if (form && props.name) {
      form.registerField(props.name, props.value ?? "", validation());
      onCleanup(() => form.unregisterField(props.name!));
    }
  });

  const resolvedValue = () => {
    if (form && props.name) {
      return form.values()[props.name];
    }
    if (props.value !== undefined) return props.value;
    if (props.bind && props.context?.state) {
      return (props.context.state as any)[props.bind];
    }
    return "";
  };

  const handleChange = (next: string) => {
    props.onChange?.(next);
    if (form && props.name) {
      form.updateValue(props.name, next, validation());
      return;
    }
    if (props.bind && props.context?.setState) {
      props.context.setState(props.bind, next);
    }
  };

  const errorMessage = () => (form && props.name ? form.errors()[props.name] : undefined);

  return (
    <div>
      <textarea
        placeholder={props.placeholder}
        rows={props.rows ?? 3}
        value={resolvedValue() ?? ""}
        onInput={(e) => handleChange(e.currentTarget.value)}
        style={{
          width: "100%",
          padding: "8px",
          border: `1px solid ${errorMessage() ? "#ef4444" : "#ccc"}`,
          "border-radius": "4px",
          "min-height": "80px",
        }}
      />
      <Show when={errorMessage()}>
        <div style={{ color: "#ef4444", "font-size": "0.875rem", "margin-top": "4px" }}>{errorMessage()}</div>
      </Show>
    </div>
  );
};

const Select: Component<{
  name?: string;
  options?: { label?: string; text?: string; value: string }[];
  placeholder?: string;
  value?: string;
  bind?: string;
  context?: UiRuntimeContext;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}> = (props) => {
  const form = useFormContext();
  const validation = () => ({
    required: props.required,
  });

  createEffect(() => {
    if (form && props.name) {
      form.registerField(props.name, props.value ?? "", validation());
      onCleanup(() => form.unregisterField(props.name!));
    }
  });

  const resolvedValue = () => {
    if (form && props.name) return form.values()[props.name];
    if (props.value !== undefined) return props.value;
    if (props.bind && props.context?.state) {
      return (props.context.state as any)[props.bind];
    }
    return "";
  };

  const handleChange = (next: string) => {
    props.onChange?.(next);
    if (form && props.name) {
      form.updateValue(props.name, next, validation());
      return;
    }
    if (props.bind && props.context?.setState) {
      props.context.setState(props.bind, next);
    }
  };

  const errorMessage = () => (form && props.name ? form.errors()[props.name] : undefined);

  return (
    <div>
      <select
        value={resolvedValue() ?? ""}
        disabled={props.disabled || form?.submitting?.()}
        onChange={(e) => handleChange(e.currentTarget.value)}
        style={{
          width: "100%",
          padding: "8px",
          border: `1px solid ${errorMessage() ? "#ef4444" : "#ccc"}`,
          "border-radius": "4px",
          background: "white",
        }}
      >
        <Show when={props.placeholder}>
          <option value="">{props.placeholder}</option>
        </Show>
        <For each={props.options || []}>
          {(opt) => <option value={opt.value}>{opt.label || opt.text || opt.value}</option>}
        </For>
      </select>
      <Show when={errorMessage()}>
        <div style={{ color: "#ef4444", "font-size": "0.875rem", "margin-top": "4px" }}>{errorMessage()}</div>
      </Show>
    </div>
  );
};

const Checkbox: Component<{
  name?: string;
  label?: string;
  checked?: boolean;
  bind?: string;
  context?: UiRuntimeContext;
  onChange?: (value: boolean) => void;
  required?: boolean;
  disabled?: boolean;
}> = (props) => {
  const form = useFormContext();

  createEffect(() => {
    if (form && props.name) {
      form.registerField(props.name, props.checked ?? false, props.required ? { required: props.required } : undefined);
      onCleanup(() => form.unregisterField(props.name!));
    }
  });

  const resolvedChecked = () => {
    if (form && props.name) return !!form.values()[props.name];
    if (props.checked !== undefined) return props.checked;
    if (props.bind && props.context?.state) {
      return !!(props.context.state as any)[props.bind];
    }
    return false;
  };

  const handleChange = (next: boolean) => {
    props.onChange?.(next);
    if (form && props.name) {
      form.updateValue(props.name, next, props.required ? { required: props.required } : undefined);
      return;
    }
    if (props.bind && props.context?.setState) {
      props.context.setState(props.bind, next);
    }
  };

  const errorMessage = () => (form && props.name ? form.errors()[props.name] : undefined);

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
      <label style={{ display: "flex", "align-items": "center", gap: "8px", cursor: props.disabled ? "not-allowed" : "pointer" }}>
        <input
          type="checkbox"
          checked={resolvedChecked()}
          disabled={props.disabled}
          onChange={(e) => handleChange(e.currentTarget.checked)}
        />
        <span>{props.label}</span>
      </label>
      <Show when={errorMessage()}>
        <span style={{ color: "#ef4444", "font-size": "0.875rem" }}>{errorMessage()}</span>
      </Show>
    </div>
  );
};

const Switch: Component<{
  name?: string;
  label?: string;
  checked?: boolean;
  bind?: string;
  context?: UiRuntimeContext;
  onChange?: (value: boolean) => void;
  required?: boolean;
  disabled?: boolean;
}> = (props) => {
  const form = useFormContext();

  createEffect(() => {
    if (form && props.name) {
      form.registerField(props.name, props.checked ?? false, props.required ? { required: props.required } : undefined);
      onCleanup(() => form.unregisterField(props.name!));
    }
  });

  const resolvedChecked = () => {
    if (form && props.name) return !!form.values()[props.name];
    if (props.checked !== undefined) return props.checked;
    if (props.bind && props.context?.state) {
      return !!(props.context.state as any)[props.bind];
    }
    return false;
  };

  const toggle = () => {
    const next = !resolvedChecked();
    props.onChange?.(next);
    if (form && props.name) {
      form.updateValue(props.name, next, props.required ? { required: props.required } : undefined);
      return;
    }
    if (props.bind && props.context?.setState) {
      props.context.setState(props.bind, next);
    }
  };

  const errorMessage = () => (form && props.name ? form.errors()[props.name] : undefined);

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
      <button
        type="button"
        onClick={toggle}
        disabled={props.disabled}
        style={{
          width: "44px",
          height: "24px",
          background: resolvedChecked() ? "#22c55e" : "#e5e7eb",
          border: "1px solid #d1d5db",
          "border-radius": "9999px",
          position: "relative",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "2px",
            left: resolvedChecked() ? "22px" : "2px",
            width: "18px",
            height: "18px",
            background: "white",
            "border-radius": "9999px",
            transition: "left 0.15s ease",
            border: "1px solid #d1d5db",
          }}
        />
      </button>
      <span>{props.label}</span>
      <Show when={errorMessage()}>
        <span style={{ color: "#ef4444", "font-size": "0.875rem" }}>{errorMessage()}</span>
      </Show>
    </div>
  );
};

const FileUpload: Component<{
  name?: string;
  label?: string;
  accept?: string;
  multiple?: boolean;
  context?: UiRuntimeContext;
  onChange?: (value: File[] | File | null) => void;
  required?: boolean;
  maxFiles?: number;
  maxSizeMB?: number;
}> = (props) => {
  const form = useFormContext();
  const validation = () => ({
    required: props.required,
    maxFiles: props.maxFiles,
    maxSizeMB: props.maxSizeMB,
  });

  createEffect(() => {
    if (form && props.name) {
      form.registerField(props.name, props.multiple ? [] : [], validation());
      onCleanup(() => form.unregisterField(props.name!));
    }
  });

  const currentValue = () => (form && props.name ? form.values()[props.name] : undefined);
  const errorMessage = () => (form && props.name ? form.errors()[props.name] : undefined);

  const handleFiles = (list: FileList | null) => {
    const files = Array.from(list || []);
    const value = props.multiple ? files : files.slice(0, 1);
    props.onChange?.(props.multiple ? value : value[0] ?? null);
    if (form && props.name) {
      form.updateValue(props.name, value, validation());
    }
  };

  const fileLabels = () => {
    const value = currentValue();
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((f) => (typeof f === "string" ? f : f.name));
    }
    if (typeof value === "string") return [value];
    return [value.name];
  };

  return (
    <div style={{ border: "1px dashed #d1d5db", padding: "12px", "border-radius": "8px", background: "#fafafa" }}>
      <label style={{ display: "block", cursor: "pointer" }}>
        <div style={{ "margin-bottom": "8px", color: "#4b5563" }}>{props.label || "Choose file"}</div>
        <input
          type="file"
          accept={props.accept}
          multiple={props.multiple}
          onChange={(e) => handleFiles(e.currentTarget.files)}
          style={{ display: "block" }}
        />
      </label>
      <Show when={fileLabels().length > 0}>
        <div style={{ "margin-top": "8px", color: "#374151", "font-size": "0.875rem" }}>{fileLabels().join(", ")}</div>
      </Show>
      <Show when={errorMessage()}>
        <div style={{ color: "#ef4444", "font-size": "0.875rem", "margin-top": "4px" }}>{errorMessage()}</div>
      </Show>
    </div>
  );
};

const ImagePicker: Component<{
  name?: string;
  label?: string;
  accept?: string;
  multiple?: boolean;
  context?: UiRuntimeContext;
  onChange?: (value: File[] | File | null) => void;
  required?: boolean;
  maxFiles?: number;
  maxSizeMB?: number;
}> = (props) => {
  const form = useFormContext();
  const validation = () => ({
    required: props.required,
    maxFiles: props.maxFiles,
    maxSizeMB: props.maxSizeMB,
  });

  createEffect(() => {
    if (form && props.name) {
      form.registerField(props.name, props.multiple ? [] : [], validation());
      onCleanup(() => form.unregisterField(props.name!));
    }
  });

  const currentFiles = () => {
    const value = form && props.name ? form.values()[props.name] : undefined;
    if (Array.isArray(value)) return value;
    if (value) return [value];
    return [];
  };

  const errorMessage = () => (form && props.name ? form.errors()[props.name] : undefined);

  const previewUrl = createMemo(() => {
    const first = currentFiles()[0];
    if (!first) return undefined;
    if (typeof first === "string") return first;
    if (typeof File !== "undefined" && first instanceof File) return URL.createObjectURL(first);
    if (typeof Blob !== "undefined" && first instanceof Blob) return URL.createObjectURL(first);
    return undefined;
  });

  createEffect(() => {
    const url = previewUrl();
    return () => {
      if (url && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    };
  });

  const handleFiles = (list: FileList | null) => {
    const files = Array.from(list || []);
    const value = props.multiple ? files : files.slice(0, 1);
    props.onChange?.(props.multiple ? value : value[0] ?? null);
    if (form && props.name) {
      form.updateValue(props.name, value, validation());
    }
  };

  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <Show when={previewUrl()}>
        <img
          src={previewUrl()}
          alt="Preview"
          style={{ width: "100%", "max-height": "220px", "object-fit": "cover", "border-radius": "8px" }}
        />
      </Show>
      <div style={{ border: "1px dashed #d1d5db", padding: "12px", "border-radius": "8px", background: "#fafafa" }}>
        <label style={{ display: "block", cursor: "pointer" }}>
          <div style={{ "margin-bottom": "8px", color: "#4b5563" }}>{props.label || "Select image"}</div>
          <input
            type="file"
            accept={props.accept || "image/*"}
            multiple={props.multiple}
            onChange={(e) => handleFiles(e.currentTarget.files)}
            style={{ display: "block" }}
          />
        </label>
      </div>
      <Show when={errorMessage()}>
        <div style={{ color: "#ef4444", "font-size": "0.875rem" }}>{errorMessage()}</div>
      </Show>
    </div>
  );
};

const TabBar: Component<{
  value?: string;
  tabs?: { label?: string; text?: string; value: string }[];
  options?: { label?: string; text?: string; value: string }[];
  onChange?: (value: string) => void;
  context?: UiRuntimeContext;
}> = (props) => {
  const items = createMemo(() => props.tabs || props.options || []);
  const currentValue = createMemo(() => props.value ?? items()[0]?.value ?? "");

  const handleSelect = (val: string) => {
    props.onChange?.(val);
  };

  return (
    <div style={{ display: "flex", gap: "8px", "margin-bottom": "8px" }}>
      <For each={items()}>
        {(item) => {
          const value = item.value;
          const label = item.label || item.text || item.value;
          const active = () => currentValue() === value;
          return (
            <button
              type="button"
              onClick={() => handleSelect(value)}
              style={{
                padding: "6px 12px",
                "border-radius": "9999px",
                border: active() ? "1px solid #2563eb" : "1px solid #e5e7eb",
                background: active() ? "#eff6ff" : "#fff",
                color: active() ? "#1d4ed8" : "#374151",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        }}
      </For>
    </div>
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
const Link: Component<{ href?: string; text?: string; action?: ActionLike; context?: UiRuntimeContext; children?: JSX.Element }> = (props) => {
  const clickHandler = (e: MouseEvent) => {
    if (props.action) {
      e.preventDefault();
      const handler = normalizeActionHandler(props.action, props.context);
      handler?.();
    }
  };

  return (
    <a
      href={props.href}
      onClick={clickHandler}
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

type SpinnerSize = "xs" | "sm" | "md" | "lg" | number;

const Spinner: Component<{ size?: SpinnerSize; variant?: "default" | "primary" | "muted"; label?: string; inline?: boolean }> = (props) => {
  const sizeMap: Record<Exclude<SpinnerSize, number>, number> = { xs: 12, sm: 16, md: 20, lg: 28 };
  const pixelSize = createMemo(() => {
    if (typeof props.size === "number" && Number.isFinite(props.size)) return Math.max(8, props.size);
    return sizeMap[(props.size as Exclude<SpinnerSize, number>) || "md"];
  });
  const palette = createMemo(() => {
    const variants: Record<"default" | "primary" | "muted", { track: string; indicator: string }> = {
      default: { track: "#e5e7eb", indicator: "#6b7280" },
      primary: { track: "#dbeafe", indicator: "#2563eb" },
      muted: { track: "#f3f4f6", indicator: "#9ca3af" },
    };
    return variants[props.variant || "default"];
  });
  const label = () => props.label || "Loading";
  const strokeWidth = createMemo(() => Math.max(2, Math.floor(pixelSize() / 8)));

  return (
    <span
      role="status"
      aria-label={label()}
      aria-live="polite"
      style={{
        display: props.inline ? "inline-flex" : "flex",
        "align-items": "center",
        "justify-content": props.inline ? "flex-start" : "center",
        gap: props.inline ? "6px" : "8px",
        "vertical-align": props.inline ? "middle" : undefined,
      }}
    >
      <svg width={`${pixelSize()}px`} height={`${pixelSize()}px`} viewBox="0 0 50 50" style={{ display: "block" }}>
        <circle cx="25" cy="25" r="20" fill="none" stroke={palette().track} stroke-width={strokeWidth()} opacity="0.4" />
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke={palette().indicator}
          stroke-width={strokeWidth()}
          stroke-linecap="round"
          stroke-dasharray="90 150"
        >
          <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.9s" repeatCount="indefinite" />
        </circle>
      </svg>
      <Show when={!props.inline && props.label}>
        <span style={{ color: "#4b5563", "font-size": "0.95rem" }}>{props.label}</span>
      </Show>
    </span>
  );
};

const EmptyState: Component<{
  icon?: string;
  title?: string;
  description?: string;
  primaryAction?: { label?: string; action?: ActionLike };
  secondaryAction?: { label?: string; action?: ActionLike };
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const runAction = (action?: ActionLike) => {
    const handler = normalizeActionHandler(action, props.context);
    handler?.();
  };

  const actionAreaStyle: JSX.CSSProperties = {
    display: "flex",
    "justify-content": "center",
    gap: "8px",
    "flex-wrap": "wrap",
    "margin-top": "4px",
  };

  const buttonStyle = (variant: "primary" | "secondary"): JSX.CSSProperties => ({
    padding: "10px 16px",
    "border-radius": "10px",
    border: variant === "primary" ? "1px solid #2563eb" : "1px solid #d1d5db",
    background: variant === "primary" ? "#2563eb" : "white",
    color: variant === "primary" ? "white" : "#111827",
    cursor: "pointer",
    "font-weight": 600,
  });

  return (
    <div
      style={{
        display: "grid",
        gap: "10px",
        padding: "24px",
        "border-radius": "12px",
        border: "1px dashed #e5e7eb",
        background: "#f8fafc",
        "text-align": "center",
        "justify-items": "center",
      }}
    >
      <Show when={props.icon}>
        <div
          style={{
            width: "56px",
            height: "56px",
            "border-radius": "14px",
            background: "#e5e7eb",
            display: "grid",
            "place-items": "center",
            color: "#374151",
          }}
        >
          <Icon name={props.icon} size={26} />
        </div>
      </Show>
      <Show when={props.title}>
        <div style={{ "font-size": "1.15rem", "font-weight": 700, color: "#111827" }}>{props.title}</div>
      </Show>
      <Show when={props.description}>
        <div style={{ color: "#4b5563", "max-width": "520px", "line-height": 1.5 }}>{props.description}</div>
      </Show>
      {props.renderChildren ? props.renderChildren() : props.children}
      <Show when={props.primaryAction || props.secondaryAction}>
        <div style={actionAreaStyle}>
          <Show when={props.primaryAction}>
            {(action) => (
              <button type="button" style={buttonStyle("primary")} onClick={() => runAction(action().action)}>
                {action().label || "Action"}
              </button>
            )}
          </Show>
          <Show when={props.secondaryAction}>
            {(action) => (
              <button type="button" style={buttonStyle("secondary")} onClick={() => runAction(action().action)}>
                {action().label || "More"}
              </button>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
};

const Stat: Component<{
  label?: string;
  value?: string | number;
  prefix?: string;
  suffix?: string;
  icon?: string;
  delta?: number;
  deltaDirection?: "up" | "down" | "neutral";
  deltaLabel?: string;
  children?: JSX.Element;
}> = (props) => {
  const direction = createMemo<"up" | "down" | "neutral">(() => {
    if (props.deltaDirection === "up" || props.deltaDirection === "down" || props.deltaDirection === "neutral") {
      return props.deltaDirection;
    }
    return "neutral";
  });

  const palette: Record<"up" | "down" | "neutral", { color: string; symbol: string }> = {
    up: { color: "#16a34a", symbol: "▲" },
    down: { color: "#dc2626", symbol: "▼" },
    neutral: { color: "#6b7280", symbol: "▬" },
  };

  const formattedValue = createMemo(() => {
    const raw = props.value;
    const asText =
      typeof raw === "number"
        ? raw.toLocaleString()
        : raw !== undefined && raw !== null
          ? String(raw)
          : "";
    const prefix = props.prefix || "";
    const suffix = props.suffix || "";
    const result = `${prefix}${asText}${suffix}`;
    return result || "-";
  });

  const hasDelta = createMemo(() => props.delta !== undefined || Boolean(props.deltaLabel));

  return (
    <div
      style={{
        display: "grid",
        gap: "6px",
        padding: "14px",
        "border-radius": "12px",
        border: "1px solid #e5e7eb",
        background: "white",
        "box-shadow": "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
        <div style={{ color: "#6b7280", "font-size": "0.95rem", "font-weight": 600 }}>{props.label}</div>
        <Show when={props.icon}>
          <div
            style={{
              width: "32px",
              height: "32px",
              "border-radius": "10px",
              background: "#f3f4f6",
              display: "grid",
              "place-items": "center",
            }}
          >
            <Icon name={props.icon} size={18} />
          </div>
        </Show>
      </div>
      <div style={{ display: "flex", "align-items": "baseline", gap: "6px" }}>
        <div style={{ "font-size": "1.8rem", "font-weight": 700, color: "#111827" }}>{formattedValue()}</div>
      </div>
      <Show when={hasDelta()}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <Show when={props.delta !== undefined}>
            <span style={{ color: palette[direction()].color, display: "inline-flex", "align-items": "center", gap: "4px", "font-weight": 600 }}>
              <span>{palette[direction()].symbol}</span>
              <span>{typeof props.delta === "number" ? props.delta.toLocaleString() : props.delta}</span>
            </span>
          </Show>
          <Show when={props.deltaLabel}>
            <span style={{ color: "#6b7280", "font-size": "0.95rem" }}>{props.deltaLabel}</span>
          </Show>
        </div>
      </Show>
      {props.children}
    </div>
  );
};

const StatGroup: Component<{
  layout?: "row" | "grid";
  columns?: number;
  gap?: number;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const layout = props.layout || "row";
  const gap = props.gap !== undefined ? `${props.gap}px` : "12px";
  const columns = Math.max(1, props.columns || 3);

  const style: JSX.CSSProperties =
    layout === "grid"
      ? {
          display: "grid",
          "grid-template-columns": `repeat(${columns}, minmax(0, 1fr))`,
          gap,
          width: "100%",
        }
      : {
          display: "flex",
          gap,
          "flex-wrap": "wrap",
          "align-items": "stretch",
        };

  return <div style={style}>{props.renderChildren ? props.renderChildren() : props.children}</div>;
};

function evaluateCondition(condition: any, context?: UiRuntimeContext): boolean {
  if (typeof condition === "boolean") return condition;
  if (condition === undefined || condition === null) return false;

  if (isPlainObject(condition)) {
    if (Object.prototype.hasOwnProperty.call(condition, "$auth")) {
      const key = (condition as any).$auth;
      if (key === "isLoggedIn") {
        return Boolean(getJWT());
      }
      if (key === "userId") {
        return Boolean(getJWT());
      }
    }
    if (Object.prototype.hasOwnProperty.call(condition, "$eq")) {
      const [a, b] = (condition as any).$eq || [];
      return resolveValue(a, context, { preserveActions: true }) === resolveValue(b, context, { preserveActions: true });
    }
    if (Object.prototype.hasOwnProperty.call(condition, "$ne")) {
      const [a, b] = (condition as any).$ne || [];
      return resolveValue(a, context, { preserveActions: true }) !== resolveValue(b, context, { preserveActions: true });
    }
    if (Object.prototype.hasOwnProperty.call(condition, "$gt")) {
      const [a, b] = (condition as any).$gt || [];
      return (resolveValue(a, context, { preserveActions: true }) as any) > (resolveValue(b, context, { preserveActions: true }) as any);
    }
    if (Object.prototype.hasOwnProperty.call(condition, "$lt")) {
      const [a, b] = (condition as any).$lt || [];
      return (resolveValue(a, context, { preserveActions: true }) as any) < (resolveValue(b, context, { preserveActions: true }) as any);
    }
  }

  const resolved = resolveValue(condition, context, { preserveActions: true });
  if (typeof resolved === "string") {
    if (resolved === "true") return true;
    if (resolved === "false") return false;
  }
  return Boolean(resolved);
}

const Conditional: Component<{
  if?: any;
  else?: UiNode[];
  node?: UiNode;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const elseNodes = () => ((props.node as any)?.props?.else as UiNode[]) || props.else || [];
  const shouldRender = createMemo(() => evaluateCondition((props as any).if ?? (props as any).condition, props.context));

  if (shouldRender()) {
    return <>{props.renderChildren ? props.renderChildren() : props.children}</>;
  }

  return <>{props.renderChildren ? props.renderChildren(undefined, elseNodes()) : null}</>;
};

const Header: Component<{
  title?: string;
  subtitle?: string;
  backHref?: string;
  backAction?: ActionLike;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const handleBack = (e: MouseEvent) => {
    const handler = normalizeActionHandler(props.backAction, props.context);
    if (handler) {
      e.preventDefault();
      handler();
    }
  };

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "12px" }}>
      <Show when={props.backHref || props.backAction}>
        <a
          href={props.backHref || "#"}
          onClick={(e) => {
            if (props.backAction) {
              handleBack(e as any);
              return;
            }
            if (!props.backHref) e.preventDefault();
          }}
          style={{ color: "#4b5563", "text-decoration": "none" }}
        >
          ←
        </a>
      </Show>
      <div style={{ flex: 1 }}>
        <div style={{ "font-size": "1.1rem", "font-weight": "700" }}>{props.title}</div>
        <Show when={props.subtitle}>
          <div style={{ color: "#6b7280", "font-size": "0.9rem" }}>{props.subtitle}</div>
        </Show>
      </div>
      {props.renderChildren ? props.renderChildren() : props.children}
    </div>
  );
};

const ScrollView: Component<{ height?: number | string; maxHeight?: number | string; children?: JSX.Element }> = (props) => {
  const toSize = (value?: number | string) => {
    if (value === undefined) return undefined;
    return typeof value === "number" ? `${value}px` : value;
  };
  return (
    <div style={{ overflow: "auto", height: toSize(props.height), "max-height": toSize(props.maxHeight) }}>
      {props.children}
    </div>
  );
};

const Sticky: Component<{ top?: number; children?: JSX.Element }> = (props) => {
  return (
    <div style={{ position: "sticky", top: props.top !== undefined ? `${props.top}px` : "0px", "z-index": 5 }}>
      {props.children}
    </div>
  );
};

const Grid: Component<{ columns?: number; gap?: number; minColumnWidth?: number | string; children?: JSX.Element }> = (props) => {
  const template = () => {
    if (props.minColumnWidth !== undefined) {
      const width = typeof props.minColumnWidth === "number" ? `${props.minColumnWidth}px` : props.minColumnWidth;
      return `repeat(auto-fit, minmax(${width}, 1fr))`;
    }
    const cols = props.columns && props.columns > 0 ? props.columns : 2;
    return `repeat(${cols}, minmax(0, 1fr))`;
  };

  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": template(),
        gap: props.gap ? `${props.gap}px` : "12px",
        width: "100%",
      }}
    >
      {props.children}
    </div>
  );
};

type TableProps = {
  id?: string;
  columns?: TableColumnDef[];
  rows?: any[];
  emptyText?: string;
  stickyHeader?: boolean;
  pageSize?: number;
  total?: number;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  node?: UiNode;
  children?: JSX.Element;
};

const Table: Component<TableProps> = (props) => {
  const [sortState, setSortState] = createSignal<{ column?: string; direction?: "asc" | "desc" }>({});
  const [page, setPage] = createSignal(1);
  const [refreshTick, setRefreshTick] = createSignal(0);

  const columns = createMemo(() => props.columns || []);
  const rows = createMemo(() => (Array.isArray(props.rows) ? props.rows : []));
  const pageSize = createMemo(() => {
    if (typeof props.pageSize !== "number") return undefined;
    if (!Number.isFinite(props.pageSize) || props.pageSize <= 0) return undefined;
    return Math.floor(props.pageSize);
  });

  createEffect(() => {
    if (props.id && props.context?.registerRefetch) {
      const unregister = props.context.registerRefetch(props.id, () => {
        setPage(1);
        setRefreshTick((n) => n + 1);
      });
      onCleanup(unregister);
    }
  });

  createEffect(() => {
    rows();
    setPage(1);
  });

  const toComparable = (value: any) => {
    if (value === undefined || value === null) return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string") {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) return numeric;
      const timestamp = Date.parse(value);
      if (!Number.isNaN(timestamp)) return timestamp;
      return value.toLowerCase();
    }
    return value;
  };

  const sortedRows = createMemo(() => {
    refreshTick();
    const current = sortState();
    const data = rows();
    if (!current.column || !current.direction) return data;
    const direction = current.direction === "desc" ? -1 : 1;
    return [...data].sort((a, b) => {
      const av = toComparable((a as any)?.[current.column as any]);
      const bv = toComparable((b as any)?.[current.column as any]);
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * direction;
      }
      return String(av).localeCompare(String(bv)) * direction;
    });
  });

  const paginatedRows = createMemo(() => {
    const size = pageSize();
    const data = sortedRows();
    if (!size) return data;
    const start = Math.max(0, (page() - 1) * size);
    return data.slice(start, start + size);
  });

  const pageCount = createMemo(() => {
    const size = pageSize();
    if (!size) return 1;
    const totalRows = rows().length;
    if (totalRows === 0) return 1;
    return Math.max(1, Math.ceil(totalRows / size));
  });

  createEffect(() => {
    const max = pageCount();
    if (page() > max) {
      setPage(max);
    }
  });

  const totalCount = createMemo(() => (typeof props.total === "number" ? props.total : rows().length));

  const startIndex = createMemo(() => {
    const size = pageSize();
    if (!size) return rows().length > 0 ? 1 : 0;
    const current = paginatedRows();
    if (current.length === 0) return 0;
    return (page() - 1) * size + 1;
  });

  const endIndex = createMemo(() => {
    const size = pageSize();
    if (!size) return rows().length;
    const current = paginatedRows();
    if (current.length === 0) return 0;
    return (page() - 1) * size + current.length;
  });

  const handleSort = (col: TableColumnDef) => {
    if (!col || !col.key || !col.sortable) return;
    setSortState((prev) => {
      if (prev.column !== col.key) {
        return { column: col.key, direction: "asc" };
      }
      if (prev.direction === "asc") {
        return { column: col.key, direction: "desc" };
      }
      return {};
    });
    setPage(1);
  };

  const renderRow = (item: any) => {
    if (props.renderChildren) {
      const childContext: Partial<UiRuntimeContext> = {
        ...(props.context || {}),
        item,
        list: rows(),
        tableColumns: columns(),
      };
      return props.renderChildren(childContext, props.node?.children);
    }
    return props.children;
  };

  const colSpan = () => Math.max(columns().length, 1);

  const pagerButtonStyle: JSX.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #d1d5db",
    background: "#f9fafb",
    color: "#111827",
    "border-radius": "6px",
    cursor: "pointer",
  };

  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <div style={{ border: "1px solid #e5e7eb", "border-radius": "8px", overflow: "hidden", background: "white" }}>
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", "border-collapse": "collapse", "min-width": "100%" }}>
            <thead>
              <tr>
                <For each={columns()}>
                  {(col) => {
                    const active = createMemo(() => sortState().column === col.key);
                    const direction = createMemo(() => sortState().direction);
                    const headerStyle: JSX.CSSProperties = {
                      background: "#f8fafc",
                      "text-align": col.align || "left",
                      padding: "10px 12px",
                      "border-bottom": "1px solid #e5e7eb",
                      width: col.width !== undefined ? (typeof col.width === "number" ? `${col.width}px` : col.width) : undefined,
                      cursor: col.sortable ? "pointer" : "default",
                      "user-select": col.sortable ? "none" : undefined,
                      position: props.stickyHeader ? "sticky" : undefined,
                      top: props.stickyHeader ? "0px" : undefined,
                      "z-index": props.stickyHeader ? 1 : undefined,
                    };
                    return (
                      <th style={headerStyle} onClick={() => handleSort(col)}>
                        <span style={{ display: "flex", "align-items": "center", gap: "6px", "white-space": "nowrap" }}>
                          <span style={{ "font-weight": 600, color: "#111827" }}>{col.label}</span>
                          <Show when={col.sortable}>
                            <span style={{ color: active() ? "#1d4ed8" : "#9ca3af", "font-size": "0.8rem" }}>
                              {active() ? (direction() === "desc" ? "▼" : "▲") : "↕"}
                            </span>
                          </Show>
                        </span>
                      </th>
                    );
                  }}
                </For>
              </tr>
            </thead>
            <tbody>
              <Show
                when={paginatedRows().length > 0}
                fallback={
                  <tr>
                    <td colSpan={colSpan()} style={{ padding: "14px", "text-align": "center", color: "#6b7280" }}>
                      {props.emptyText || "No data"}
                    </td>
                  </tr>
                }
              >
                <For each={paginatedRows()}>
                  {(item) => renderRow(item)}
                </For>
              </Show>
            </tbody>
          </table>
        </div>
      </div>
      <Show when={pageSize()}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", color: "#4b5563", "font-size": "0.9rem" }}>
          <div>
            <Show when={startIndex() > 0}>
              <span>
                Showing {startIndex()}-{endIndex()} of {totalCount()}
              </span>
            </Show>
            <Show when={startIndex() === 0}>
              <span>Showing 0 of {totalCount()}</span>
            </Show>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page() <= 1}
              style={{ ...pagerButtonStyle, opacity: page() <= 1 ? 0.6 : 1 }}
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount(), p + 1))}
              disabled={page() >= pageCount()}
              style={{ ...pagerButtonStyle, opacity: page() >= pageCount() ? 0.6 : 1 }}
            >
              Next
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};

const TableRow: Component<{
  key?: string;
  selected?: boolean;
  hoverable?: boolean;
  onClick?: ActionLike;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const [hovered, setHovered] = createSignal(false);
  const clickable = () => Boolean(props.onClick);
  const hoverable = () => Boolean(props.hoverable || clickable());

  const background = createMemo(() => {
    if (props.selected) return "#eef2ff";
    if (hoverable() && hovered()) return "#f8fafc";
    return undefined;
  });

  const handleClick = (e: MouseEvent) => {
    if (!props.onClick) return;
    e.preventDefault();
    const handler = normalizeActionHandler(props.onClick, props.context);
    handler?.();
  };

  return (
    <tr
      data-row-key={props.key}
      onClick={clickable() ? handleClick : undefined}
      onMouseEnter={hoverable() ? () => setHovered(true) : undefined}
      onMouseLeave={hoverable() ? () => setHovered(false) : undefined}
      style={{
        background: background(),
        cursor: clickable() ? "pointer" : undefined,
        "transition": "background 0.12s ease",
      }}
    >
      {props.renderChildren ? props.renderChildren() : props.children}
    </tr>
  );
};

const TableCell: Component<{
  column?: string;
  content?: any;
  align?: "left" | "center" | "right";
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const columnDef = createMemo(() => (props.context?.tableColumns || []).find((col) => col.key === props.column));
  const alignment = createMemo(() => props.align || columnDef()?.align || "left");
  const width = createMemo(() => {
    const value = columnDef()?.width;
    if (value === undefined) return undefined;
    return typeof value === "number" ? `${value}px` : value;
  });

  const hasContent = () => props.content !== undefined && props.content !== null;

  return (
    <td
      style={{
        padding: "10px 12px",
        "border-bottom": "1px solid #e5e7eb",
        "text-align": alignment(),
        width: width(),
        color: "#111827",
        "vertical-align": "middle",
      }}
    >
      <Show when={hasContent()} fallback={props.renderChildren ? props.renderChildren() : props.children}>
        {props.content}
      </Show>
    </td>
  );
};

const Tabs: Component<{
  tabs?: { label?: string; text?: string; value: string; content?: UiNode[] }[];
  value?: string;
  onChange?: (value: string) => void;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  node?: UiNode;
  children?: JSX.Element;
}> = (props) => {
  const [internal, setInternal] = createSignal<string | undefined>(undefined);
  const tabs = createMemo(() => props.tabs || ((props.node as any)?.props?.tabs as any[]) || []);

  createEffect(() => {
    if (props.value !== undefined) {
      setInternal(props.value);
    }
  });

  const currentValue = createMemo(() => props.value ?? internal() ?? tabs()[0]?.value ?? "");

  const handleChange = (val: string) => {
    setInternal(val);
    props.onChange?.(val);
  };

  const activeContent = createMemo(() => tabs().find((tab) => tab.value === currentValue()));

  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <TabBar value={currentValue()} tabs={tabs()} onChange={handleChange} />
      <div>
        <Show when={activeContent()}>
          {(tab) =>
            props.renderChildren
              ? props.renderChildren(props.context, (tab().content as UiNode[]) || (props.node?.children as UiNode[]) || [])
              : props.children
          }
        </Show>
      </div>
    </div>
  );
};

const Modal: Component<{
  open?: boolean;
  title?: string;
  onClose?: ActionLike;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const close = () => {
    const handler = normalizeActionHandler(props.onClose, props.context);
    handler?.();
  };

  return (
    <Show when={props.open}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": 50,
          padding: "12px",
        }}
        onClick={close}
      >
        <div
          style={{
            background: "white",
            padding: "16px",
            "border-radius": "12px",
            width: "min(520px, 90vw)",
            "box-shadow": "0 10px 30px rgba(0,0,0,0.2)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "8px" }}>
            <span style={{ "font-weight": "700" }}>{props.title}</span>
            <button
              type="button"
              onClick={close}
              style={{ background: "transparent", border: "none", cursor: "pointer", "font-size": "1rem" }}
            >
              ✕
            </button>
          </div>
          {props.renderChildren ? props.renderChildren() : props.children}
        </div>
      </div>
    </Show>
  );
};

const BottomSheet: Component<{
  open?: boolean;
  title?: string;
  onClose?: ActionLike;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const close = () => {
    const handler = normalizeActionHandler(props.onClose, props.context);
    handler?.();
  };

  return (
    <Show when={props.open}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          display: "flex",
          "align-items": "flex-end",
          "justify-content": "center",
          "z-index": 50,
        }}
        onClick={close}
      >
        <div
          style={{
            background: "white",
            width: "100%",
            "max-width": "640px",
            padding: "16px",
            "border-radius": "16px 16px 0 0",
            "box-shadow": "0 -4px 20px rgba(0,0,0,0.15)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "8px" }}>
            <span style={{ "font-weight": "700" }}>{props.title}</span>
            <button
              type="button"
              onClick={close}
              style={{ background: "transparent", border: "none", cursor: "pointer", "font-size": "1rem" }}
            >
              ✕
            </button>
          </div>
          {props.renderChildren ? props.renderChildren() : props.children}
        </div>
      </div>
    </Show>
  );
};

const buildPathWithQuery = (path: string, query?: Record<string, any>) => {
  if (!query || typeof query !== "object") return path;
  const search = new URLSearchParams();
  const appendParam = (key: string, value: any) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v) => appendParam(key, v));
      return;
    }
    search.append(key, String(value));
  };
  Object.entries(query).forEach(([key, value]) => appendParam(key, value));
  const qs = search.toString();
  if (!qs) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${qs}`;
};

/**
 * ApiData Component - fetches data from API and renders children with data context
 */
const ApiData: Component<{
  id?: string;
  source?: DataSource;
  path?: string;
  method?: string;
  body?: any;
  query?: Record<string, any>;
  headers?: Record<string, string>;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const [data, { refetch }] = createResource(
    () => ({
      path: props.source?.path || props.path || "",
      method: props.source?.method || props.method || "GET",
      body: props.body,
      query: props.query || props.source?.params,
      headers: props.headers,
    }),
    async (params) => {
      if (!params.path) return null;
      try {
        const requestPath = buildPathWithQuery(params.path, params.query);
        const method = (params.method || "GET").toUpperCase();
        const init: Record<string, any> = { method, headers: params.headers };
        if (method !== "GET") {
          init.body = params.body;
        }
        return await api(requestPath, init);
      } catch (err) {
        console.error("[ApiData] Fetch error:", err);
        return null;
      }
    }
  );

  createEffect(() => {
    if (props.id && props.context?.registerRefetch) {
      const unregister = props.context.registerRefetch(props.id, () => refetch());
      onCleanup(unregister);
    }
  });

  const childContext = createMemo(() => ({
    ...(props.context || {}),
    data: data() ?? null,
  }));

  return (
    <Suspense fallback={<div style={{ padding: "8px", color: "#6b7280" }}>Loading...</div>}>
      <Show when={data()} fallback={<div style={{ color: "#ef4444" }}>Failed to load data</div>}>
        {props.renderChildren ? props.renderChildren(childContext()) : props.children}
      </Show>
    </Suspense>
  );
};

/**
 * ApiList Component - fetches list data and renders items
 */
const ApiList: Component<{
  id?: string;
  source?: DataSource;
  path?: string;
  query?: Record<string, any>;
  itemTemplate?: UiNode;
  emptyText?: string;
  context?: UiRuntimeContext;
  renderChildren?: UiComponentProps["renderChildren"];
  children?: JSX.Element;
}> = (props) => {
  const [items, { refetch }] = createResource(
    () => buildPathWithQuery(props.source?.path || props.path || "", props.query || props.source?.params),
    async (path) => {
      if (!path) return [];
      try {
        const data = await api(path);
        const payload = (data as any)?.data ?? data;
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.items)) return payload.items;
        if (Array.isArray(payload?.data)) return payload.data;
        return [];
      } catch (err) {
        console.error("[ApiList] Fetch error:", err);
        return [];
      }
    }
  );

  createEffect(() => {
    if (props.id && props.context?.registerRefetch) {
      const unregister = props.context.registerRefetch(props.id, () => refetch());
      onCleanup(unregister);
    }
  });

  const renderItem = (item: any) => {
    if (props.renderChildren) {
      const explicit = props.itemTemplate ? [props.itemTemplate] : undefined;
      return props.renderChildren(
        {
          ...(props.context || {}),
          item,
          list: items() || [],
        },
        explicit
      );
    }
    return props.children;
  };

  return (
    <Suspense fallback={<div style={{ padding: "8px", color: "#6b7280" }}>Loading...</div>}>
      <Show
        when={items() && items()!.length > 0}
        fallback={<div style={{ padding: "16px", color: "#6b7280", "text-align": "center" }}>{props.emptyText || "No items"}</div>}
      >
        <For each={items()}>
          {(item) => (
            <div data-item={JSON.stringify(item)}>
              {renderItem(item)}
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
  Form,
  TextArea,
  Select,
  Checkbox,
  Switch,
  FileUpload,
  ImagePicker,
  TabBar,
  Card,
  Image,
  Link,
  Divider,
  Badge,
  Icon,
  Spinner,
  EmptyState,
  Stat,
  StatGroup,
  Conditional,
  Header,
  ScrollView,
  Sticky,
  Grid,
  Table,
  TableRow,
  TableCell,
  Tabs,
  Modal,
  BottomSheet,
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

  const resolvedProps = createMemo(() => resolveValue(node.props || {}, context));

  const renderChildren = (overrideContext?: Partial<UiRuntimeContext>, explicitChildren?: UiNode[]) => {
    const nextContext = overrideContext ? { ...(context || {}), ...overrideContext } : context;
    const targets = explicitChildren || node.children || [];
    if (!targets || targets.length === 0) return null;
    return (
      <For each={targets}>
        {(child) => <RenderUiNode node={child} context={nextContext} />}
      </For>
    );
  };

  // Render children recursively
  const children = createMemo(() => renderChildren());

  // Pass props, context, and rendered children to component
  return (
    <ComponentImpl {...resolvedProps()} context={context} node={node} renderChildren={renderChildren}>
      {children()}
    </ComponentImpl>
  );
};

/**
 * Screen Renderer
 *
 * Renders a Screen definition from App Manifest
 */
export const RenderScreen: Component<{ screen: Screen; context?: UiRuntimeContext }> = (props) => {
  const initialState: Record<string, any> = {};
  if (props.screen.state) {
    for (const [key, def] of Object.entries(props.screen.state)) {
      initialState[key] = def?.default;
    }
 }

  const [state, setState] = createStore(initialState);
  const navigate = useNavigate();
  const refreshers = new Map<string, () => void>();

  const setStateByKey = (key: string, value: any) => {
    if (!(key in state)) {
      console.warn(`[UiRuntime] Attempted to set undeclared state key: ${key}`);
    }
    setState(key as any, () => value);
  };

  const registerRefetch = (id: string, handler: () => void) => {
    if (!id || typeof handler !== "function") {
      return () => undefined;
    }
    refreshers.set(id, handler);
    return () => refreshers.delete(id);
  };

  const refresh = (target?: string | string[]) => {
    if (!target) {
      refreshers.forEach((fn) => fn());
      return;
    }
    const keys = Array.isArray(target) ? target : [target];
    keys.forEach((key) => {
      const fn = refreshers.get(key);
      fn?.();
    });
  };

  const runtimeContext = createMemo<UiRuntimeContext>(() => ({
    ...(props.context || {}),
    state,
    setState: setStateByKey,
    navigate,
    refresh,
    registerRefetch,
  }));

  return (
    <div data-screen-id={props.screen.id} data-screen-route={props.screen.route}>
      <RenderUiNode node={props.screen.layout} context={runtimeContext()} />
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
