// WAI-ARIA tabs keyboard support. Our tablists declare role="tab"/aria-selected
// but a `role="tablist"` widget also promises arrow-key navigation + a single
// tab stop (roving tabindex); without it, screen-reader/keyboard users can't
// move between tabs the way the role advertises. This centralizes that handler
// so every tablist (search / DM / notifications / friends) behaves identically.
//
// Usage: spread roving tabindex onto each tab (`tabindex={active ? 0 : -1}`) and
// wire the tablist container's onKeyDown to `handleTablistKeydown`.
export function handleTablistKeydown(
  e: KeyboardEvent & { currentTarget: HTMLElement },
  count: number,
  current: number,
  select: (index: number) => void,
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
  // Move focus to the newly-selected tab so the roving tab stop follows.
  const tabs = e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
  tabs[next]?.focus();
}
