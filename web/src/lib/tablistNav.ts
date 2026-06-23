// WAI-ARIA roving-tabindex keyboard support. A `role="tablist"`/`role="radiogroup"`
// widget promises arrow-key navigation + a single tab stop (roving tabindex);
// without it, screen-reader/keyboard users can't move between the items the way
// the role advertises. This centralizes that handler so every such group
// (tablists: search / DM / notifications / friends; the home-filter radiogroup)
// behaves identically.
//
// Usage: spread roving tabindex onto each item (`tabindex={active ? 0 : -1}`) and
// wire the container's onKeyDown to handleRovingKeydown (or the tablist alias).
export function handleRovingKeydown(
  e: KeyboardEvent & { currentTarget: HTMLElement },
  count: number,
  current: number,
  select: (index: number) => void,
  itemRole: "tab" | "radio" = "tab",
): void {
  if (count <= 0) return;
  let next = current;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = (current + 1) % count;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = (current - 1 + count) % count;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  select(next);
  // Move focus to the newly-selected item so the roving tab stop follows.
  const items = e.currentTarget.querySelectorAll<HTMLElement>(
    `[role="${itemRole}"]`,
  );
  items[next]?.focus();
}

/** Tablist alias (role="tab"); kept for the existing tablist call sites. */
export function handleTablistKeydown(
  e: KeyboardEvent & { currentTarget: HTMLElement },
  count: number,
  current: number,
  select: (index: number) => void,
): void {
  handleRovingKeydown(e, count, current, select, "tab");
}
