import type { Component } from "solid-js";

type Props = {
  src?: string;
  alt?: string;
  class?: string;
  variant?: "user" | "community";
};

const userSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24"><rect width="100%" height="100%" fill="#E5E7EB"/><g fill="#888"><circle cx="12" cy="8" r="3"/><path d="M12 14c-4 0-6 2-6 3v1h12v-1c0-1-2-3-6-3z"/></g></svg>`;
const communitySvg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64" role="img" aria-label="コミュニティのアイコン"><rect width="100%" height="100%" fill="#F3F4F6" rx="8"/>
  <g fill="#6B7280" transform="translate(0,0)">
    <!-- center person -->
    <circle cx="32" cy="22" r="8" />
    <path d="M18 46c0-6 6-10 14-10s14 4 14 10v4H18v-4z" fill="#9CA3AF"/>
    <!-- left person (smaller, behind) -->
    <circle cx="18" cy="26" r="6" fill="#6B7280"/>
    <path d="M8 46c0-5 4-8 10-8v2c-6 0-10 3-10 6v2H8v-2z" fill="#9CA3AF"/>
    <!-- right person (smaller, behind) -->
    <circle cx="46" cy="26" r="6" fill="#6B7280"/>
    <path d="M38 46c0-5 4-8 10-8v2c-6 0-10 3-10 6v2h-?z" fill="#9CA3AF"/>
  </g>
</svg>`;

const DEFAULT_USER_AVATAR = "data:image/svg+xml;utf8," +
  encodeURIComponent(userSvg);
const DEFAULT_COMMUNITY_AVATAR = "data:image/svg+xml;utf8," +
  encodeURIComponent(communitySvg);

const Avatar: Component<Props> = (props) => {
  const variant = () => props.variant || "user";
  const src = () =>
    props.src ||
    (variant() === "community"
      ? DEFAULT_COMMUNITY_AVATAR
      : DEFAULT_USER_AVATAR);
  const onErr = (e: any) => {
    const target = e.currentTarget;
    const fallback = variant() === "community"
      ? DEFAULT_COMMUNITY_AVATAR
      : DEFAULT_USER_AVATAR;
    if (target.src !== fallback) target.src = fallback;
  };
  return (
    <img
      src={src()}
      alt={props.alt || "アバター"}
      class={props.class}
      onError={onErr}
    />
  );
};

export default Avatar;
