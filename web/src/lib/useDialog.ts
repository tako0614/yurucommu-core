import { createEffect, onCleanup, type Accessor } from "solid-js";

interface UseDialogOptions {
  // Reactive open/closed state. The behaviours below activate only while true.
  isOpen: Accessor<boolean>;
  // Called when the user presses Escape inside the dialog.
  onClose: () => void;
  // Resolves the dialog's root element. Returns null until the element is
  // mounted (e.g. behind a <Show>). Re-evaluated on every open.
  container: () => HTMLElement | null | undefined;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      // offsetParent is null for display:none; visibility:hidden also fails.
      (el.offsetParent !== null || el.getClientRects().length > 0),
  );
}

/**
 * Shared modal-dialog behaviour primitive. Wire it into any overlay component
 * that renders a focusable surface behind a reactive `isOpen` flag. While open
 * it: saves the previously focused element, moves focus into the dialog, traps
 * Tab within the dialog, closes on Escape, restores focus on close, and locks
 * background scroll. All of this is a no-op while closed.
 *
 * MediaLightbox / StoryViewer predate this and keep their own Escape + scroll
 * wiring; this hook is the canonical implementation for the remaining overlays
 * (ScopeSwitcherSheet, CreateScopeModal, ConfirmSheet, the AppMenu drawer).
 */
export function useDialog(options: UseDialogOptions): void {
  createEffect(() => {
    if (!options.isOpen()) return;

    // Defer until the dialog element exists in the DOM (it renders inside a
    // <Show> that flips on the same tick we open).
    const root = options.container();
    if (!root) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Move focus into the dialog. Prefer the first focusable control; fall back
    // to the dialog container itself (made programmatically focusable).
    const focusables = focusableWithin(root);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
      root.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        options.onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusableWithin(root);
      if (items.length === 0) {
        // Nothing tabbable inside — keep focus pinned to the dialog.
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !root.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);

    // Lock background scroll.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      // Restore focus to whatever was focused before the dialog opened, as long
      // as it is still in the document.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    });
  });
}
