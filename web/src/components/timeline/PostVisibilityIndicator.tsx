import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../../lib/i18n.tsx";

// Small inline reach indicator shown in a post header. Public posts get NO icon
// (it is the default — flagging it would just add clutter); only a narrower
// reach (unlisted / followers / direct) is marked so the author can confirm
// their post is restricted and a reader can see who can see it.

const svgProps = {
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;

function LockIcon(): JSX.Element {
  return (
    <svg {...svgProps}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnlockIcon(): JSX.Element {
  return (
    <svg {...svgProps}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function MailIcon(): JSX.Element {
  return (
    <svg {...svgProps}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

export function PostVisibilityIndicator(props: {
  visibility: string;
}): JSX.Element {
  const t = useI18n().t;
  const meta = (): { label: string; icon: JSX.Element } | null => {
    switch (props.visibility) {
      case "unlisted":
        return { label: t("posts.visibilityUnlisted"), icon: <UnlockIcon /> };
      case "followers":
        return { label: t("posts.visibilityFollowers"), icon: <LockIcon /> };
      case "direct":
        return { label: t("posts.visibilityDirect"), icon: <MailIcon /> };
      default:
        return null; // public — no indicator
    }
  };
  return (
    <Show when={meta()}>
      {(m) => (
        <span
          class="text-neutral-500 shrink-0 inline-flex items-center"
          title={m().label}
          aria-label={m().label}
        >
          {m().icon}
        </span>
      )}
    </Show>
  );
}
