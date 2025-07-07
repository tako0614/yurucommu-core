import { createSignal, Setter } from "solid-js";

export function PopUpFrame(
  { children, closeScript }: { children: any; closeScript: Setter<boolean> },
) {
  return (
    <div class="fixed z-50 w-full h-full bg-[rgba(75,92,108,0.4)] left-0 top-0 flex justify-center items-center p-3 md:pb-3 pb-[76px]">
      <div class="bg-[rgba(255,255,255,0.7)] dark:bg-[rgba(24,24,24,0.7)] backdrop-blur border-inherit border-1 w-full h-full p-5 rounded-xl shadow-lg relative md:ml-[78px]">
        <div class="absolute right-0 top-0 p-4">
          <span
            class="ml-0 text-3xl text-black dark:text-white font-[bold] no-underline cursor-pointer"
            onClick={() => {
              closeScript(false);
            }}
          >
            ×
          </span>
        </div>
        <div class="overflow-auto h-full">
          {children}
        </div>
      </div>
    </div>
  );
}
