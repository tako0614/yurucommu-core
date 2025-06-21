import { createEffect, onCleanup } from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedExtensionState } from "../states/extensions.ts";
import { createTakos } from "../takos.ts";
import { loadExtensionWorker } from "../extensionWorker.ts";

export default function ExtensionFrame() {
  const [extId] = useAtom(selectedExtensionState);
  let frame: HTMLIFrameElement | undefined;

  createEffect(() => {
    if (frame && extId()) {
      frame.src = `/api/extensions/${extId()}/ui`;
    }
  });

  async function onLoad() {
    try {
      if (frame?.contentWindow && extId()) {
        const id = extId()!;
        const takos = createTakos(id);
        (frame.contentWindow as any).takos = takos;

        const worker = await loadExtensionWorker(id, takos);
        const host = window as any;
        const defs = host.__takosEventDefs?.[id] || {};
        const events = host.__takosClientEvents?.[id] || {};
        const child = frame.contentWindow as any;
        child.__takosEventDefs = child.__takosEventDefs || {};
        child.__takosEventDefs[id] = defs;
        child.__takosClientEvents = child.__takosClientEvents || {};
        child.__takosClientEvents[id] = events;
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
      sandbox="allow-scripts allow-same-origin"
      class="w-full h-full border-none"
      onLoad={onLoad}
    />
  );
}
