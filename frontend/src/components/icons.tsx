import type { JSX } from "solid-js";

type IconProps = JSX.SvgSVGAttributes<SVGSVGElement> & {
  size?: number;
  strokeWidth?: number;
};

const svgAttrs = (props: IconProps): JSX.SvgSVGAttributes<SVGSVGElement> => ({
  width: props.size ?? 24,
  height: props.size ?? 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": props.strokeWidth ?? 1.8,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  xmlns: "http://www.w3.org/2000/svg",
});

export function IconHome(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 10.5V20a2 2 0 0 0 2 2h4v-6h6v6h2a2 2 0 0 0 2-2V10.5" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <circle cx="11" cy="11" r="6" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <circle cx="12" cy="8" r="3" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <circle cx="16" cy="8" r="3" />
      <circle cx="9" cy="10" r="3" />
      <path d="M12 20c0-3 3-5 6-5" />
      <path d="M3 20c0-3 3-5 6-5" />
    </svg>
  );
}

export function IconMessage(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconMessagePlus(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <path d="M21 12.5V17a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h9" />
      <line x1="16" y1="3" x2="16" y2="11" />
      <line x1="12" y1="7" x2="20" y2="7" />
    </svg>
  );
}

export function IconHeart(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <path d="M12 21s-8-5.5-8-10a4.8 4.8 0 0 1 8-3.5A4.8 4.8 0 0 1 20 11c0 4.5-8 10-8 10z" />
    </svg>
  );
}

export function IconThumbUp(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <path d="M7 22H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h2z" />
      <path d="M7 12h6l2-5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7" />
    </svg>
  );
}

export function IconComment(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <rect x="3" y="4" width="18" height="14" rx="3" />
      <path d="M8 18l-3 3v-3" />
    </svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.38 1l0 .1a2 2 0 1 1-4 0l0-.1a1.65 1.65 0 0 0-.38-1 1.65 1.65 0 0 0-1-.38 1.65 1.65 0 0 0-1 .38 1.65 1.65 0 0 0-.6 1l-.1 0a2 2 0 1 1 0-4l.1 0a1.65 1.65 0 0 0 1-.38 1.65 1.65 0 0 0 .38-1 1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.38l-.1 0a2 2 0 1 1 0-4l.1 0a1.65 1.65 0 0 0 1-.38 1.65 1.65 0 0 0 .38-1 1.65 1.65 0 0 0-.6-1l.06-.06A2 2 0 1 1 3.4 4.4l.06.06A1.65 1.65 0 0 0 5 4.6a1.65 1.65 0 0 0 1-.38 1.65 1.65 0 0 0 .38-1l0-.1a2 2 0 1 1 4 0l0 .1a1.65 1.65 0 0 0 .38 1 1.65 1.65 0 0 0 1 .38 1.65 1.65 0 0 0 1-.38 1.65 1.65 0 0 0 .6-1l.1 0a2 2 0 1 1 4 0l-.1 0a1.65 1.65 0 0 0-.6 1 1.65 1.65 0 0 0 .38 1 1.65 1.65 0 0 0 1 .38 1.65 1.65 0 0 0 1-.38l.06-.06A2 2 0 1 1 22.2 6.2l-.06.06A1.65 1.65 0 0 0 21 7.6a1.65 1.65 0 0 0-1 .38 1.65 1.65 0 0 0-.38 1 1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1 .38l.1 0a2 2 0 1 1 0 4l-.1 0a1.65 1.65 0 0 0-1 .38 1.65 1.65 0 0 0-.38 1Z" />
    </svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20 1-7 7-13z" />
    </svg>
  );
}

export function IconQr(props: IconProps) {
  return (
    <svg {...svgAttrs(props)} class={props.class}>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="15" width="6" height="6" rx="1" />
      <path d="M15 15h2v2h-2z" />
      <path d="M19 15h2v2" />
      <path d="M21 21h-2v-2" />
      <path d="M17 21h-2v-2" />
    </svg>
  );
}
