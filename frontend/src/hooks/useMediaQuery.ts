import { useEffect, useState } from 'react';

/**
 * Drives the workspace's desktop-grid vs. mobile-drawer split from JS, not just CSS: below the
 * breakpoint, `DraftWorkspace` swaps to rendering the Draft Log / My Team toggle buttons and drawer
 * chrome; above it, those never enter the DOM at all, so there's no off-screen focus trap or
 * hidden-but-tabbable toggle button to worry about on desktop.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQueryList = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQueryList.matches);
    handleChange();
    mediaQueryList.addEventListener('change', handleChange);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
