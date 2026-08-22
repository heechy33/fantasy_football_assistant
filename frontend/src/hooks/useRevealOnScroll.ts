import { useEffect, useRef } from 'react';

/**
 * Scroll-reveal for landing chapters: adds a `revealed` class to every descendant carrying
 * `[data-reveal]` once it enters the viewport, letting CSS own the transition (see the
 * `.landing-chapter [data-reveal]` rules in App.css). Native IntersectionObserver — no GSAP —
 * keeps the bundle light and matches the repo's zero-animation-library baseline.
 *
 * Degradations:
 * - No IntersectionObserver (old browsers / jsdom): everything reveals immediately.
 * - `prefers-reduced-motion`: CSS disables the transition, so elements are simply visible.
 */
export function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('revealed'));
      return;
    }
    // Threshold 0.15 so a block is visibly on its way in before it animates; unobserve after
    // firing because the reveal is one-shot by design.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return ref;
}
