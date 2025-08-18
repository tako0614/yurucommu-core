import { JSX, splitProps } from "solid-js";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

function classes(variant: Variant, size: Size, disabled?: boolean) {
  const base =
    "inline-flex items-center justify-center font-medium transition-colors duration-150 rounded-md focus-visible:outline-none disabled:opacity-60 disabled:cursor-not-allowed";
  const v = {
    primary:
      "bg-gray-600 hover:bg-gray-700 text-white focus-visible:shadow-[0_0_0_3px_rgba(148,163,184,0.45)]",
    secondary:
      "bg-[#2a2a2a] hover:bg-[#333] text-gray-100 border border-[#3a3a3a]",
    ghost: "bg-transparent hover:bg-[#2a2a2a] text-gray-200",
    danger: "bg-rose-600 hover:bg-rose-500 text-white",
  }[variant];
  const s = { sm: "px-2.5 h-8 text-sm", md: "px-3.5 h-10", lg: "px-4.5 h-12 text-lg" }[
    size
  ];
  return [base, v, s, disabled ? "pointer-events-none" : ""].join(" ");
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["children", "variant", "size", "loading", "disabled"]);
  const variant = local.variant ?? "primary";
  const size = local.size ?? "md";

  return (
    <button
      {...rest}
      class={classes(variant, size, local.disabled || local.loading) + (rest.class ? ` ${rest.class}` : "")}
      disabled={local.disabled || local.loading}
    >
      {local.loading && (
        <svg
          class="animate-spin -ml-0.5 mr-2 h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {local.children}
    </button>
  );
}

export default Button;
