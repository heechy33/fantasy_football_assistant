/**
 * Brand identity for the provider comparison sections (ADP-by-provider,
 * projections-by-provider). `color` is used for the monogram fallback chip and
 * accent bars; `monogram` is the text shown when no committed SVG asset exists.
 * A matching `frontend/src/assets/providers/<key>.svg` is resolved at build time
 * by ProviderBadge and inlined; a committed `<key>.avif`/`<key>-logo.png` raster
 * renders as an <img>; until then the monogram chip is the drop-in.
 */
export type ProviderBrandKey =
  | 'espn'
  | 'sleeper'
  | 'cbs'
  | 'rtsports'
  | 'fantrax'
  | 'fftoday'
  | 'ffc'
  | 'underdog';

export interface ProviderBrand {
  key: ProviderBrandKey;
  label: string;
  color: string;
  monogram: string;
}

export const PROVIDER_BRANDS: Readonly<Record<ProviderBrandKey, ProviderBrand>> = {
  espn: { key: 'espn', label: 'ESPN', color: '#e4442c', monogram: 'ESPN' },
  sleeper: { key: 'sleeper', label: 'Sleeper', color: '#00e4a0', monogram: 'S' },
  cbs: { key: 'cbs', label: 'CBS', color: '#1d5dad', monogram: 'CBS' },
  rtsports: { key: 'rtsports', label: 'RTSports', color: '#7c4dff', monogram: 'RTS' },
  fantrax: { key: 'fantrax', label: 'Fantrax', color: '#f2991d', monogram: 'F' },
  fftoday: { key: 'fftoday', label: 'FFToday', color: '#2f9e44', monogram: 'FFT' },
  ffc: { key: 'ffc', label: 'FFC', color: '#0d9488', monogram: 'FFC' },
  underdog: { key: 'underdog', label: 'Underdog', color: '#8a5cf6', monogram: 'UD' },
};

export function providerBrand(key: string): ProviderBrand | null {
  return PROVIDER_BRANDS[key as ProviderBrandKey] ?? null;
}
