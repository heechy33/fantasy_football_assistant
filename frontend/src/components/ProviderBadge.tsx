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

// Raster fallback for brands whose committed asset is a bitmap (Sleeper's PNG logo,
// Underdog's official AVIF mark) rather than an inline-able SVG — same committed-asset trust
// boundary as the SVG map above, rendered as an <img> pointing at the build-emitted URL.
const providerImage = import.meta.glob('../assets/providers/*.{png,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Brand-colored logo chip that inlines a committed SVG when present, falls back to a committed
 * raster image (PNG/AVIF), and finally to a monogram. Used by the ADP/projection provider
 * sections. */
export function ProviderBadge({ brandKey, size = 'default' }: ProviderBadgeProps) {
  const brand = providerBrand(brandKey);
  const svgPath = Object.keys(providerSvg).find((path) => path.endsWith(`/${brandKey}.svg`));
  const svg = svgPath ? providerSvg[svgPath] : null;
  const imagePath = Object.keys(providerImage).find(
    (path) => path.endsWith(`/${brandKey}.avif`) || path.endsWith(`/${brandKey}-logo.png`),
  );
  const image = imagePath ? providerImage[imagePath] : null;

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
  if (image) {
    return (
      <span className="provider-badge provider-badge-img" data-size={size} data-brand={brandKey}>
        <img src={image} alt={label} title={label} />
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
