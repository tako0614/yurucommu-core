import { createEffect, onCleanup } from "solid-js";
import { useAtom } from "solid-jotai";
import {
  selectedExtensionState,
} from "../states/extensions.ts";

export default function ExtensionFrame() {
  const [extId] = useAtom(selectedExtensionState);
  let frame: HTMLIFrameElement | undefined;

  createEffect(() => {
    if (frame && extId()) {
      frame.src = `/api/extensions/${extId()}/ui`;
    }
  });

  function onLoad() {
    try {
      if (frame?.contentWindow) {
        (frame.contentWindow as any).takos = (window as any).takos;
      }
    } catch (_e) {
      /* ignore */
    }
  }

  onCleanup(() => {
    if (frame) frame.src = "about:blank";
  });

  return (
    <iframe
      ref={frame!}
      sandbox="allow-scripts"
      class="w-full h-full border-none"
      onLoad={onLoad}
    />
  );
}
