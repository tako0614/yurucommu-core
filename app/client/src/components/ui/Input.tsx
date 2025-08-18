import { JSX, splitProps } from "solid-js";

export interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "hint",
    "error",
    "id",
    "class",
  ]);
  const id = local.id ?? crypto.randomUUID();

  return (
    <div class={"space-y-1.5 " + (local.class ?? "")}>
      {local.label && (
        <label for={id} class="block text-sm font-medium text-gray-300">
          {local.label}
        </label>
      )}
      <input
        id={id}
        {...rest}
        class={"w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-gray-100 placeholder-gray-500 focus-visible:border-cyan-500 " +
          (rest.class ? rest.class : "")}
        aria-invalid={local.error ? "true" : "false"}
        aria-describedby={local.hint ? `${id}-hint` : undefined}
      />
      {local.hint && (
        <p id={`${id}-hint`} class="text-xs text-gray-400">{local.hint}</p>
      )}
      {local.error && (
        <p role="alert" class="text-xs text-rose-400">{local.error}</p>
      )}
    </div>
  );
}

export default Input;
