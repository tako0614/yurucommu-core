import { createSignal, onMount, Show } from "solid-js";
import {
  getAdsenseAccount,
  getAdsenseClient,
  getAdsenseSlot,
  loadAdsenseConfig,
} from "../utils/adsense.ts";

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
  var adsbygoogle: unknown[];
}

export function GoogleAd() {
  const [client, setClient] = createSignal<string | null>(null);
  const [slot, setSlot] = createSignal<string | null>(null);

  onMount(async () => {
    await loadAdsenseConfig();
    setClient(getAdsenseClient());
    setSlot(getAdsenseSlot());
    if (!getAdsenseClient() || !getAdsenseSlot()) return;
    if (typeof document !== "undefined") {
      if (
        getAdsenseAccount() &&
        !document.querySelector("meta[name='google-adsense-account']")
      ) {
        const m = document.createElement("meta");
        m.name = "google-adsense-account";
        m.content = getAdsenseAccount()!;
        document.head.appendChild(m);
      }
      if (!document.querySelector("script[data-adsense]")) {
        const s = document.createElement("script");
        s.src =
          `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${getAdsenseClient()}`;
        s.async = true;
        s.crossOrigin = "anonymous";
        s.setAttribute("data-adsense", "true");
        document.head.appendChild(s);
      }
    }
    globalThis.adsbygoogle = globalThis.adsbygoogle || [];
    globalThis.adsbygoogle.push({});
  });

  return (
    <Show when={client() && slot()}>
      <ins
        class="adsbygoogle"
        style="display:block"
        data-ad-client={client()!}
        data-ad-slot={slot()!}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </Show>
  );
}
