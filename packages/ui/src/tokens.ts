/**
 * Design tokens for freecall.
 *
 * These are the source of truth. Tailwind config and CSS variables reference these values
 * so colour changes happen in one place.
 *
 * Naming convention: {category}-{scale} where scale is 50–950 (perceptually uniform).
 */

export const tokens = {
  /** Brand accent — vivid emerald. */
  accent: {
    50: "#ecfdf5",
    100: "#d1fae5",
    200: "#a7f3d0",
    300: "#6ee7b7",
    400: "#34d399",
    500: "#10b981",
    600: "#059669",
    700: "#047857",
    800: "#065f46",
    900: "#064e3b",
    950: "#022c22",
  },

  /** Danger / destructive — rose. */
  danger: {
    400: "#fb7185",
    500: "#f43f5e",
    600: "#e11d48",
    700: "#be123c",
  },

  /** Surface — near-black for dark mode UI. */
  surface: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    600: "#52525b",
    700: "#3f3f46",
    800: "#27272a",
    900: "#18181b",
    950: "#09090b",
  },

  /** Typography. */
  text: {
    primary: "#fafafa",
    secondary: "#a1a1aa",
    muted: "#71717a",
    disabled: "#52525b",
  },

  /** Border / dividers. */
  border: {
    default: "rgba(255,255,255,0.08)",
    strong: "rgba(255,255,255,0.15)",
  },

  /** Border radii. */
  radius: {
    sm: "0.375rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.5rem",
    full: "9999px",
  },

  /** Spacing scale (rem). */
  spacing: {
    1: "0.25rem",
    2: "0.5rem",
    3: "0.75rem",
    4: "1rem",
    6: "1.5rem",
    8: "2rem",
    12: "3rem",
    16: "4rem",
    24: "6rem",
  },
} as const;
