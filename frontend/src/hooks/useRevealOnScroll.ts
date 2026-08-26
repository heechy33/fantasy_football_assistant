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

    const observeTarget = (el: HTMLElement, observer: IntersectionObserver): void => {
      // One-shot by design: once revealed an element never needs observing again.
      if (el.classList.contains('revealed')) return;
      observer.observe(el);
    };

    if (typeof IntersectionObserver === 'undefined') {
      root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => el.classList.add('revealed'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        });
      },
      // Threshold 0.15 so a block is visibly on its way in before it animates.
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );

    const observeAll = (): void => {
      root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => observeTarget(el, observer));
    };
    observeAll();

    // Landing sections render conditionally AFTER mount — Home's Sleeper/ESPN provider panels only
    // exist once the "Connect your league" gate opens — and a one-shot querySelectorAll at effect
    // time misses them. An unobserved [data-reveal] node keeps App.css's `opacity: 0` forever,
    // which is exactly how the connect forms became invisible after clicking the gate CTA
    // (2026-08-24 regression). Watch the subtree so post-mount targets get registered too.
    const mutations = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.hasAttribute('data-reveal')) observeTarget(node, observer);
          node.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => observeTarget(el, observer));
        });
      });
    });
    mutations.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  return ref;
}
