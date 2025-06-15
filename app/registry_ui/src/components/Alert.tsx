export default function Alert(props: {
  message: string;
  type?: "info" | "error";
  onClose?: () => void;
}) {
  const color = props.type === "error" ? "red" : "blue";
  const icon = props.type === "error"
    ? "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
    : "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z";
  return (
    <div
      class={`bg-${color}-500/10 border border-${color}-500/30 rounded-xl p-4`}
    >
      <div class="flex items-start space-x-2">
        <svg
          class={`w-5 h-5 text-${color}-400`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d={icon} />
        </svg>
        <p class={`text-${color}-300 text-sm flex-1`}>{props.message}</p>
        {props.onClose && (
          <button
            type="button"
            onClick={props.onClose}
            class={`text-${color}-400 hover:text-${color}-300`}
          >
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
