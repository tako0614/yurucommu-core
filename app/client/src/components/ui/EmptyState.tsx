import { JSX } from "solid-js";

export function EmptyState(props: { icon?: JSX.Element; title: string; description?: string; action?: JSX.Element; }) {
  return (
    <div class="surface p-8 text-center">
      <div class="mx-auto w-12 h-12 mb-3 text-cyan-400">
        {props.icon ?? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-full h-full">
            <path fill="currentColor" d="M19 3H5a2 2 0 00-2 2v14l4-3h12a2 2 0 002-2V5a2 2 0 00-2-2z" />
          </svg>
        )}
      </div>
      <h3 class="text-lg font-semibold text-gray-100">{props.title}</h3>
      {props.description && (
        <p class="text-gray-400 mt-1">{props.description}</p>
      )}
      {props.action && (
        <div class="mt-4">{props.action}</div>
      )}
    </div>
  );
}

export default EmptyState;

