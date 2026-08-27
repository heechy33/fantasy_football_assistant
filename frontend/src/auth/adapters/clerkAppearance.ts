/**
 * The `appearance` prop shape consumed by <SignIn>/<SignUp>. Not re-exported publicly by
 * @clerk/clerk-react 5.61 (it renders them via `@clerk/shared`'s internal theme types), so this
 * is declared locally; both naming schemes below are plain custom-property bags to Clerk either
 * way, so a loose record type is exactly what the components accept.
 */
interface ClerkAppearance {
  variables?: Record<string, string | number>;
  elements?: Record<string, Record<string, string | number>>;
}

/**
 * Shared Clerk theming for <SignIn>/<SignUp> (and later <UserProfile> if gated) — the app's
 * Broadcast Ink palette translated onto Clerk's component surface so the auth screens read as the
 * same product as `/` and `/draft-guide`.
 *
 * WHY RAW HEX VALUES: this repo's rule elsewhere is literals-free (tokens.css/App.css), but Clerk
 * injects its styles inside its own scoped roots where our `--surface-*`/`--accent-cool`
 * custom properties are NOT reliably inherited, so every value below is copied verbatim from its
 * committed token (source noted inline). If a value changes in tokens.css, update it here too.
 *
 * ORANGE STAYS OUT: `#f97316` (--accent) is urgency-only in this UI — nothing on an auth screen is
 * urgent, so the identity accent #35a7ff (--accent-cool) is the primary everywhere.
 *
 * VARIABLES — BOTH NAMING SCHEMES: @clerk/clerk-react 5.x migrated its theme API to `--clerk-*`
 * design tokens; we supply those AND the legacy camelCase aliases because which set actually
 * applies varies across minor versions. Unknown keys are inert (plain custom properties), so
 * carrying both is belt-and-braces rather than a correctness risk.
 */
export const clerkAppearance: ClerkAppearance = {
  variables: {
    // New-token naming (--clerk-* becomes a real CSS variable):
    '--clerk-font-family': '"Inter", ui-sans-serif, system-ui, "Segoe UI", sans-serif',
    '--clerk-border-radius': '9px',                                     // --radius-md
    '--clerk-background': '#10141a',                                    // --surface-2
    '--clerk-color-background': '#10141a',                              // --surface-2
    '--clerk-color-text': '#ececec',                                    // --text-1
    '--clerk-color-text-secondary': '#b4b4b4',                          // --text-3
    '--clerk-color-primary': '#35a7ff',                                 // --accent-cool
    '--clerk-color-input-background': '#151a21',                        // --surface-3
    '--clerk-color-input-text': '#ececec',                              // --text-1

    // Legacy aliases (pre-migration naming), same values:
    fontFamily: '"Inter", ui-sans-serif, system-ui, "Segoe UI", sans-serif',
    borderRadius: '9px',
    colorBackground: '#10141a',
    colorText: '#ececec',
    colorTextSecondary: '#b4b4b4',
    colorPrimary: '#35a7ff',
    colorInputBackground: '#151a21',
    colorInputText: '#ececec',
  },
  elements: {
    /* Element overrides are the second layer: values the variable surface can't reach, keyed by
       Clerk's stable element class names. Kept minimal — anything Clerk already derives correctly
       from the variables above is deliberately NOT restyled here. */
    card: {
      // --border-1 (#6e6e6e) is the app's functional card edge (3.45:1 on surface-2); Clerk's own
      // default shadow language reads foreign on this flat near-black UI, so shadow off, border on.
      backgroundColor: '#10141a',
      border: '1px solid #6e6e6e',
      boxShadow: 'none',
    },
    headerTitle: {
      // Display role: Archivo per tokens.css type hierarchy (section headers/card titles).
      fontFamily: '"Archivo", ui-sans-serif, system-ui, sans-serif',
      fontWeight: 800,
      letterSpacing: '-.015em',
      color: '#ececec',
    },
    headerSubtitle: {
      color: '#b4b4b4',
    },
    formButtonPrimary: {
      // Solid neon-blue CTA, inked exactly like .primary-button.landing-hero-cta.
      backgroundColor: '#35a7ff',
      color: '#04070a',
      border: 'none',
      fontWeight: 700,
    },
    socialButtonsBlockButton: {
      // Quiet chrome buttons matching the global dark control surface (—chrome-2) with the
      // functional list-item border (--border-2).
      backgroundColor: '#141a21',
      color: '#f2f6fb',
      borderColor: '#6a6a6a',
      fontWeight: 600,
    },
    dividerLine: {
      // Decorative hairline only (—border-divider) — never a functional edge here either.
      backgroundColor: '#1e242b',
    },
    footerActionLink: {
      // Links carry the identity accent, matching nav active state / eyebrows.
      color: '#35a7ff',
      fontWeight: 700,
    },
  },
};
