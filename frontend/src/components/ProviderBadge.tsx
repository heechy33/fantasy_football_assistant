import type { CSSProperties } from 'react';
import { providerBrand } from '../data/providerBrand';

interface ProviderBadgeProps {
  /** Brand key; an unknown key still renders a neutral chip (never nothing). */
  brandKey: string;
  size?: 'default' | 'sm';
}

// Eager, raw-inlined at build time. A missing asset simply doesn't appear in the
// map, so the monogram chip is the zero-asset drop-in and a real logo becomes
// `frontend/src/assets/providers/<key>.svg`. Inline-only — no remote image URLs,
// consistent with the app's offline-capable static hosting.
const providerSvg = import.meta.glob('../assets/providers/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

// Raster fallback for brands whose committed asset is a PNG (e.g. Sleeper's
// logo) rather than an SVG — same committed-asset trust boundary as the SVG
// map above, just rendered as an <img> instead of inlined markup.
const providerPng = import.meta.glob('../assets/providers/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Brand-colored logo chip that inlines a committed SVG when present, falls
 * back to a committed PNG, and finally to a monogram. Used by the ADP/projection
 * provider sections. */
export function ProviderBadge({ brandKey, size = 'default' }: ProviderBadgeProps) {
  const brand = providerBrand(brandKey);
  const svgPath = Object.keys(providerSvg).find((path) => path.endsWith(`/${brandKey}.svg`));
  const svg = svgPath ? providerSvg[svgPath] : null;
  const pngPath = Object.keys(providerPng).find((path) => path.endsWith(`/${brandKey}-logo.png`));
  const png = pngPath ? providerPng[pngPath] : null;

  const label = brand?.label ?? brandKey;
  if (!brand) {
    return (
      <span className="provider-badge provider-badge-fallback" data-size={size} role="img" aria-label={label} title={label}>
        {brandKey}
      </span>
    );
  }
  if (svg) {
    return (
      <span
        className="provider-badge provider-badge-svg"
        data-size={size}
        data-brand={brandKey}
        role="img"
        aria-label={label}
        title={label}
        // The SVG is our own committed asset (no remote URLs) and carries no
        // scripts; inlining it here is the same trust boundary as <img>.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  if (png) {
    return (
      <span className="provider-badge provider-badge-png" data-size={size} data-brand={brandKey}>
        <img src={png} alt={label} title={label} />
      </span>
    );
  }
  return (
    <span
      className="provider-badge provider-badge-monogram"
      data-size={size}
      data-brand={brandKey}
      role="img"
      aria-label={label}
      title={label}
      style={{ '--provider-color': brand.color } as CSSProperties}
    >
      {brand.monogram}
    </span>
  );
}
