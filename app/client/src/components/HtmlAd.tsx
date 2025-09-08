import { Component, onCleanup, onMount } from "solid-js";

interface HtmlAdProps {
  html: string | null | undefined;
  class?: string;
}

const HtmlAd: Component<HtmlAdProps> = (props) => {
  let container: HTMLDivElement | undefined;
  let injectedScriptElements: HTMLScriptElement[] = [];

  onMount(() => {
    if (!container) return;
    // set innerHTML for static nodes (ins, divs, etc.)
    container.innerHTML = props.html ?? "";

    // Parse and find script tags inside the provided HTML
    const scripts = Array.from(container.querySelectorAll("script"));
    for (const s of scripts) {
      try {
        const src = s.getAttribute("src");
        if (src) {
          // avoid duplicate injection: check if a script with same src exists
          const exists = Array.from(document.scripts).some(
            (ds) => ds.src === new URL(src, location.href).href,
          );
          if (!exists) {
            const script = document.createElement("script");
            // copy attributes
            for (let i = 0; i < s.attributes.length; i++) {
              const attr = s.attributes.item(i)!;
              script.setAttribute(attr.name, attr.value);
            }
            script.src = src;
            // append to head to execute
            document.head.appendChild(script);
            injectedScriptElements.push(script);
          }
        } else {
          // inline script: create and execute
          const inline = document.createElement("script");
          inline.text = s.textContent ?? "";
          document.head.appendChild(inline);
          injectedScriptElements.push(inline);
        }
      } catch (e) {
        // ignore failures to inject individual scripts
        console.warn("HtmlAd: failed to inject script", e);
      }
    }
  });

  onCleanup(() => {
    // remove injected scripts to avoid duplicates on unmount
    for (const el of injectedScriptElements) {
      try {
        if (el.parentNode) el.parentNode.removeChild(el);
      } catch (err) {
        // ignore removal errors
        console.warn("HtmlAd: failed to remove injected script", err);
      }
    }
    injectedScriptElements = [];
  });

  return <div ref={(el) => (container = el)} class={props.class ?? ""} />;
};

export default HtmlAd;
