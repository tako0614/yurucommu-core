import { createEffect, onCleanup, type Accessor } from "solid-js";

interface UseDialogOptions {
  // Reactive open/closed state. The behaviours below activate only while true.
  isOpen: Accessor<boolean>;
  // Called when the user presses Escape inside the dialog.
  onClose: () => void;
  // Resolves the dialog's root element. Returns null until the element is
  // mounted (e.g. behind a <Show>). Re-evaluated on every open.
  container: () => HTMLElement | null | undefined;
  // Optional element to focus when the dialog opens. When omitted, focus
  // prefers an element with [autofocus], else the first focusable control.
  initialFocus?: () => HTMLElement | null | undefined;
  // Optional element to focus on CLOSE when the element that opened the dialog
  // was removed by the dialog's action (e.g. a destructive in-list delete). When
  // omitted (or detached) focus falls back to the main content landmark so it
  // never silently drops to <body>.
  returnFocus?: () => HTMLElement | null | undefined;
}

/**
 * Pick where focus should land on close: the explicit returnFocus target if
 * still mounted, else the main content landmark (made programmatically
 * focusable). Avoids dropping focus to <body> after a destructive action
 * detaches the element that opened the dialog.
 */
function focusFallback(explicit: HTMLElement | null | undefined): void {
  if (explicit && explicit.isConnected) {
    explicit.focus();
    return;
  }
  const main = document.querySelector<HTMLElement>("main, [role='main']");
  if (main) {
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus();
  }
}

interface DialogEntry {
  root: HTMLElement;
  onClose: () => void;
}

// Module-level stack of currently-open dialogs. Only the top-most entry
// responds to Escape / Tab so that nested dialogs (e.g. a scope switcher on
// top of the composer) don't both close on a single Escape.
const dialogStack: DialogEntry[] = [];

// Refcounted scroll-lock so concurrent dialogs lock/unlock in an
// order-independent way. The first opener captures the prior overflow; the
// last closer restores it.
let scrollLockCount = 0;
let savedBodyOverflow = "";

function lockScroll(): void {
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
}

function unlockScroll(): void {
  scrollLockCount -= 1;
  if (scrollLockCount <= 0) {
    scrollLockCount = 0;
    document.body.style.overflow = savedBodyOverflow;
  }
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

    // Move focus into the dialog. Prefer an explicit initialFocus target, then
    // an element marked [autofocus], then the first focusable control; fall
    // back to the dialog container itself (made programmatically focusable).
    const explicit = options.initialFocus?.();
    const autofocusTarget = root.querySelector<HTMLElement>("[autofocus]");
    const focusables = focusableWithin(root);
    const focusTarget = explicit ?? autofocusTarget ?? focusables[0] ?? null;
    if (focusTarget) {
      focusTarget.focus();
    } else {
      if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
      root.focus();
    }

    // Register this dialog on the shared stack. Only the top-most entry will
    // react to Escape / Tab.
    const entry: DialogEntry = { root, onClose: options.onClose };
    dialogStack.push(entry);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only the top-most dialog responds to keyboard interaction.
      if (dialogStack[dialogStack.length - 1] !== entry) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        entry.onClose();
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

    // Lock background scroll (refcounted across concurrent dialogs).
    lockScroll();

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const idx = dialogStack.indexOf(entry);
      if (idx !== -1) dialogStack.splice(idx, 1);
      unlockScroll();
      // Restore focus to whatever was focused before the dialog opened. If that
      // element was removed by a destructive action (isConnected === false),
      // fall back to an explicit returnFocus target, then the main landmark, so
      // focus never silently drops to <body>.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      } else {
        focusFallback(options.returnFocus?.());
      }
    });
  });
}
