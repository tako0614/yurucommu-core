import { onMount } from "solid-js";

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
  var adsbygoogle: unknown[];
}

export function GoogleAd() {
  const client = import.meta.env.VITE_ADSENSE_CLIENT;
  const slot = import.meta.env.VITE_ADSENSE_SLOT;
  const account = import.meta.env.VITE_ADSENSE_ACCOUNT;

  onMount(() => {
    if (!client || !slot) return;
    if (typeof document !== "undefined") {
      if (
        account &&
        !document.querySelector("meta[name='google-adsense-account']")
      ) {
        const m = document.createElement("meta");
        m.name = "google-adsense-account";
        m.content = account;
        document.head.appendChild(m);
      }
      if (!document.querySelector("script[data-adsense]")) {
        const s = document.createElement("script");
        s.src =
          `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
        s.async = true;
        s.crossOrigin = "anonymous";
        s.setAttribute("data-adsense", "true");
        document.head.appendChild(s);
      }
    }
    globalThis.adsbygoogle = globalThis.adsbygoogle || [];
    globalThis.adsbygoogle.push({});
  });

  if (!client || !slot) return null;

  return (
    <ins
      class="adsbygoogle"
      style="display:block"
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
