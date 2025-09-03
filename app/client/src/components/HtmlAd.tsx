import { Component } from "solid-js";

interface HtmlAdProps {
  html: string | null | undefined;
  class?: string;
}

const HtmlAd: Component<HtmlAdProps> = (props) => {
  return (
    <div
      class={props.class ?? ""}
      // intentional use of innerHTML for ad fragments provided via server config
      // caller is responsible for ensuring the HTML is safe/trusted
      innerHTML={props.html ?? ""}
    />
  );
};

export default HtmlAd;
