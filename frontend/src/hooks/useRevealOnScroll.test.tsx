import { act, render } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { useRevealOnScroll } from './useRevealOnScroll';

/**
 * Regression tests for the post-mount reveal fix. The landing page renders its Sleeper/ESPN
 * provider panels only after Home's "Connect your league" gate opens — a one-shot
 * querySelectorAll at effect time misses those nodes, leaving them at App.css's `opacity: 0`
 * forever (the invisible-connect-forms regression). jsdom has no IntersectionObserver, so these
 * tests stub one whose observations can be driven manually.
 */

interface FakeEntry {
  target: Element;
  isIntersecting: boolean;
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: (entries: FakeEntry[]) => void;
  observed = new Set<Element>();

  constructor(callback: (entries: FakeEntry[]) => void) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(el: Element): void {
    this.observed.add(el);
  }

  unobserve(el: Element): void {
    this.observed.delete(el);
  }

  disconnect(): void {
    this.observed.clear();
  }

  intersect(target: Element): void {
    this.callback([{ target, isIntersecting: true }]);
  }
}

function Landing({ gateOpen }: { gateOpen: boolean }) {
  const ref = useRevealOnScroll<HTMLDivElement>();
  return (
    <div ref={ref}>
      <section data-reveal>hero</section>
      {gateOpen && (
        <section data-reveal id="provider-panel">
          Sleeper connect form
        </section>
      )}
    </div>
  );
}

describe('useRevealOnScroll', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeIntersectionObserver.instances = [];
  });

  it('observes [data-reveal] nodes that mount AFTER the hook effect ran', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver as unknown as typeof IntersectionObserver);
    const { rerender } = render(<Landing gateOpen={false} />);
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    const io = FakeIntersectionObserver.instances[0]!;
    expect(io.observed.size).toBe(1);

    // "Click Connect your league": the provider panel mounts after the observer was created.
    await act(async () => {
      rerender(<Landing gateOpen />);
    });
    const panel = document.querySelector('#provider-panel')!;
    expect(io.observed.has(panel)).toBe(true);

    // When the panel scrolls into view it actually reveals.
    act(() => {
      io.intersect(panel);
    });
    expect(panel.classList.contains('revealed')).toBe(true);
  });

  it('reveals everything immediately when IntersectionObserver is unavailable (jsdom fallback)', () => {
    const { container } = render(<Landing gateOpen={false} />);
    for (const el of container.querySelectorAll('[data-reveal]')) {
      expect(el.classList.contains('revealed')).toBe(true);
    }
  });
});