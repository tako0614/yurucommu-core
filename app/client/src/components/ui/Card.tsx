import { JSX, splitProps } from "solid-js";

// Use section-compatible attributes instead of div to avoid ref/type mismatch
export interface CardProps extends JSX.HTMLAttributes<HTMLElement> {
  title?: string;
  actions?: JSX.Element;
}

export function Card(props: CardProps) {
  const [local, rest] = splitProps(props, ["children", "title", "actions", "class"]);
  return (
    <section
      {...rest}
      class={("surface p-5 " + (local.class ?? ""))}
      role="region"
    >
      {(local.title || local.actions) && (
        <header class="mb-3 flex items-center justify-between">
          {local.title && (
            <h3 class="text-lg font-semibold text-gray-100">{local.title}</h3>
          )}
          {local.actions}
        </header>
      )}
      <div>{local.children}</div>
    </section>
  );
}

export default Card;

