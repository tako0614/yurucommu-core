import { JSX, splitProps } from "solid-js";

export type SkeletonProps = JSX.HTMLAttributes<HTMLDivElement> & {
  rounded?: string; // e.g. 'rounded-md'
};

export function Skeleton(props: SkeletonProps) {
  const [local, rest] = splitProps(props, ["class", "rounded"]);
  const rounded = local.rounded ?? "rounded-md";
  return (
    <div
      {...rest}
      class={`skeleton ${rounded} ${local.class ?? ""}`}
      aria-hidden="true"
    />
  );
}

export default Skeleton;
