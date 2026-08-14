import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Shared accessible-dialog behavior for `Drawer` and `ManualPickCorrection`.
 * Both render a fixed backdrop + `role="dialog"` without a native `<dialog>` element, so focus
 * trap, initial focus, Escape-to-close, focus restoration, and scroll lock are done by hand.
 *
 * Returns a ref for the dialog container; attach it to the outermost `role="dialog"` element.
 *
 * `active` supports drawers that stay mounted and toggle open state. Passing `active={false}`
 * makes this a no-op so the trap/scroll-lock only engages while the overlay is presented.
 */
export function useModalFocus<T extends HTMLElement = HTMLElement>(onClose: () => void, active = true): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    const focusable = container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const first = focusable?.[0];
    // Fall back to the container itself (needs tabIndex=-1 in the consumer) when the dialog has no
    // focusable content yet, e.g. a loading state before the player board has data.
    (first ?? container)?.focus();

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !container) return;
      const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      if (!firstNode || !lastNode) {
        event.preventDefault();
        return;
      }
      const activeElement = document.activeElement;
      if (event.shiftKey) {
        if (activeElement === firstNode || !container.contains(activeElement)) {
          event.preventDefault();
          lastNode.focus();
        }
      } else if (activeElement === lastNode || !container.contains(activeElement)) {
        event.preventDefault();
        firstNode.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
      previouslyFocused.current?.focus();
    };
    // onClose is expected to be stable enough for a dialog's lifetime; re-running this on every
    // render would re-steal focus and re-run the scroll-lock effect. `active` is the intended
    // re-trigger: a drawer flipping open re-runs this exactly once, same as a modal mounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return containerRef;
}
