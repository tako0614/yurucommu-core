import { createEffect, JSX, Setter, Show } from "solid-js";

interface PopUpFrameProps {
  children: JSX.Element;
  closeScript: Setter<boolean>;
}

export function PopUpFrame(props: PopUpFrameProps) {
  // ESCキー押下で閉じる機能
  createEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.closeScript(false);
      }
    };
    document.addEventListener("keydown", handleEsc);

    return () => {
      document.removeEventListener("keydown", handleEsc);
    };
  });

  return (
    <div
      class="fixed inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.5)] animate-fadeIn z-[9999999999999999999999999]"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          props.closeScript(false);
        }
      }}
    >
      <div
        class="bg-[#242424] rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col p-4 m-2"
        style={{
          "position": "relative",
          "z-index": "10001",
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

export function PopUpTitle({ children }: { children: string }) {
  return (
    <div class="text-sm">
      <p class="text-black dark:text-white font-bold text-3xl mt-4 mb-5">
        {children}
      </p>
    </div>
  );
}
export function PopUpLabel(
  { children, htmlFor }: { children: string; htmlFor: string },
) {
  return (
    <>
      <label
        for={htmlFor}
        class="block mb-2 text-sm font-medium text-black dark:text-white"
      >
        {children}
      </label>
    </>
  );
}

export function PopUpInput(
  { type, placeholder, state }: {
    type: string;
    placeholder: string;
    state: Setter<string>;
  },
) {
  return (
    <>
      <input
        class="bg-white border border-[rgba(0,0,0,5%)] shadow-[0_0.5px_1.5px_rgba(0,0,0,30%),0_0_0_0_rgba(0,122,255,50%)] focus:shadow-[0_0.5px_1.5px_rgba(0,0,0,30%),0_0_0_3px_rgba(0,122,255,50%)] text-gray-900 text-sm rounded-lg focus:ring-2 ring-1 ring-[rgba(0,0,0,5%)] outline-none block w-full p-2.5"
        onChange={(e) => {
          if (!e.target) {
            return;
          }
          const target = e.target as HTMLInputElement;
          state(target.value);
        }}
        placeholder={placeholder}
        type={type}
      />
    </>
  );
}
