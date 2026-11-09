/**
 * Edulab theme for Astryx – the edustyl "Editorial Color" design system
 * (~/.claude/skills/edustyl/tokens/colors_and_type.css) expressed as Astryx
 * tokens and component overrides.
 *
 * Light only: edustyl defines no dark palette, so every colour is a single
 * value and the app pins mode="light" while this theme is active.
 *
 * Build:  npx astryx theme build src/themes/edulab/edulabTheme.ts
 * Add:    npx astryx theme add edulab
 */

import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

// ─── edustyl source values ───

const EDU = {
  paper: "#FFFFFF",
  paper2: "#F5F3F0", // stone band: card heads, muted fills
  paper3: "#EAE6E0", // deepest stone: wells, bar tracks
  ink: "#1C1917",
  ink2: "#44403C",
  ink3: "#625B53",
  line: "#E0DBD3",
  line2: "#C9C2B7",
  lineStrong: "#857C69", // control boundaries, >= 3:1
  yellow: "#FFD500",
  yellow600: "#F0C800",
  blue: "#1E8FC2",
  blue600: "#177AA8",
  green: "#00A651",
  green600: "#078342",
  red: "#E5322D",
  red600: "#C92823",
  grape: "#7A5AC2",
  berry: "#C6478B",
  white: "#FFFFFF",
} as const;

// Fonts (Outfit, IBM Plex Sans, Roboto Mono) load via <link> tags in index.html.

/** Light tint of a brand colour on white (pale panels and muted fills). */
const tint = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, ${EDU.white})`;

/** Solid chip fill + its AA text colour, per Astryx hue name. */
const HUE_FILL: Record<string, [string, string]> = {
  red: [EDU.red600, EDU.white],
  orange: [EDU.yellow, EDU.ink], // edulab has no orange: yellow is the "attention" hue
  yellow: [EDU.yellow, EDU.ink],
  green: [EDU.green600, EDU.white],
  teal: [EDU.blue600, EDU.white],
  cyan: [EDU.blue600, EDU.white],
  blue: [EDU.blue600, EDU.white],
  purple: [EDU.grape, EDU.white],
  pink: [EDU.berry, EDU.white],
  gray: [EDU.paper3, EDU.ink],
};

const hueChips = (key: "color" | "variant") =>
  Object.fromEntries(
    Object.entries(HUE_FILL).map(([hue, [bg, fg]]) => [
      `${key}:${hue}`,
      { backgroundColor: bg, color: fg },
    ]),
  );

export const edulabTheme = defineTheme({
  name: "edulab",
  extends: neutralTheme,

  // Outfit for headings, IBM Plex Sans for text, Roboto Mono for code/data.
  // edustyl body is 16px; the explainer reads at a distance, so base 18 with a 1.25 step.
  typography: {
    scale: { base: 18, ratio: 1.25 },
    body: {
      family: "IBM Plex Sans",
      fallbacks: "system-ui, -apple-system, sans-serif",
    },
    heading: {
      family: "Outfit",
      fallbacks: '"IBM Plex Sans", system-ui, sans-serif',
      weights: { 1: "bold", 2: "bold", 3: "bold", 4: "bold" },
    },
    code: {
      family: "Roboto Mono",
      fallbacks: 'ui-monospace, "SF Mono", Menlo, monospace',
    },
  },

  tokens: {
    // Paper & surfaces
    "--color-background-body": EDU.paper,
    "--color-background-surface": EDU.paper,
    "--color-background-card": EDU.paper,
    "--color-background-popover": EDU.paper,
    "--color-background-muted": EDU.paper2,

    // Yellow primary with dark ink on it
    "--color-accent": EDU.yellow,
    "--color-accent-muted": tint(EDU.yellow, 30),
    "--color-on-accent": EDU.ink,
    "--color-text-accent": EDU.blue600, // yellow fails as text; links use AA blue
    "--color-icon-accent": EDU.ink,
    "--color-neutral": EDU.paper2,

    // Ink
    "--color-text-primary": EDU.ink,
    "--color-text-secondary": EDU.ink2,
    "--color-text-disabled": EDU.ink3,
    "--color-on-dark": EDU.white,
    "--color-on-light": EDU.ink,
    "--color-icon-primary": EDU.ink,
    "--color-icon-secondary": EDU.ink2,
    "--color-icon-disabled": EDU.ink3,

    // Lines
    "--color-border": EDU.line,
    "--color-border-emphasized": EDU.lineStrong,

    // Overlays
    "--color-overlay": "rgba(28, 25, 23, 0.5)",
    "--color-overlay-hover": "rgba(28, 25, 23, 0.05)",
    "--color-overlay-pressed": "rgba(28, 25, 23, 0.10)",
    "--color-tint-hover": EDU.ink,
    "--color-skeleton": EDU.paper3,
    "--color-shadow": "rgba(33, 30, 26, 0.12)",

    // Status: strong fills use the AA "-600" shades
    "--color-info": EDU.blue600,
    "--color-on-info": EDU.white,
    "--color-info-muted": tint(EDU.blue, 14),
    "--color-on-info-muted": EDU.ink,
    "--color-success": EDU.green600,
    "--color-on-success": EDU.white,
    "--color-success-muted": tint(EDU.green, 14),
    "--color-on-success-muted": EDU.ink,
    "--color-warning": EDU.yellow,
    "--color-on-warning": EDU.ink,
    "--color-warning-muted": tint(EDU.yellow, 30),
    "--color-on-warning-muted": EDU.ink,
    "--color-error": EDU.red600,
    "--color-on-error": EDU.white,
    "--color-error-muted": tint(EDU.red, 12),
    "--color-on-error-muted": EDU.ink,
    "--color-text-info": EDU.blue600,
    "--color-text-success": EDU.green600,
    "--color-text-warning": EDU.ink2, // yellow is never text; the icon carries the hue
    "--color-text-error": EDU.red600,

    // Hue families (Card variants, pale panels); chips get solid fills below
    "--color-background-red": tint(EDU.red, 12),
    "--color-text-red": EDU.red600,
    "--color-icon-red": EDU.red600,
    "--color-border-red": EDU.red,
    "--color-background-orange": tint(EDU.yellow, 30),
    "--color-text-orange": EDU.ink,
    "--color-icon-orange": EDU.ink,
    "--color-border-orange": EDU.yellow600,
    "--color-background-yellow": tint(EDU.yellow, 30),
    "--color-text-yellow": EDU.ink,
    "--color-icon-yellow": EDU.ink,
    "--color-border-yellow": EDU.yellow600,
    "--color-background-green": tint(EDU.green, 14),
    "--color-text-green": EDU.green600,
    "--color-icon-green": EDU.green600,
    "--color-border-green": EDU.green,
    "--color-background-teal": tint(EDU.blue, 14),
    "--color-text-teal": EDU.blue600,
    "--color-icon-teal": EDU.blue600,
    "--color-border-teal": EDU.blue,
    "--color-background-cyan": tint(EDU.blue, 14),
    "--color-text-cyan": EDU.blue600,
    "--color-icon-cyan": EDU.blue600,
    "--color-border-cyan": EDU.blue,
    "--color-background-blue": tint(EDU.blue, 14),
    "--color-text-blue": EDU.blue600,
    "--color-icon-blue": EDU.blue600,
    "--color-border-blue": EDU.blue,
    "--color-background-purple": tint(EDU.grape, 14),
    "--color-text-purple": EDU.grape,
    "--color-icon-purple": EDU.grape,
    "--color-border-purple": EDU.grape,
    "--color-background-pink": tint(EDU.berry, 14),
    "--color-text-pink": EDU.berry,
    "--color-icon-pink": EDU.berry,
    "--color-border-pink": EDU.berry,
    "--color-background-gray": EDU.paper3,
    "--color-text-gray": EDU.ink,
    "--color-icon-gray": EDU.ink2,
    "--color-border-gray": EDU.line2,

    // Radii: friendly and generous (r-xs 6, r-sm 10, r-lg 20, r-xl 28)
    "--radius-inner": "6px",
    "--radius-element": "10px",
    "--radius-container": "20px",
    "--radius-page": "28px",

    // Warm, low, soft shadows
    "--shadow-low":
      "0 1px 2px rgba(33,30,26,.10), 0 2px 6px rgba(33,30,26,.06)",
    "--shadow-med":
      "0 6px 18px rgba(33,30,26,.12), 0 1px 3px rgba(33,30,26,.08)",
    "--shadow-high":
      "0 16px 40px rgba(33,30,26,.12), 0 3px 8px rgba(33,30,26,.06)",
  },

  components: {
    // Primary button: yellow pill, dark text, display font
    button: {
      base: {
        borderRadius: "999px",
        fontFamily: "var(--font-family-heading)",
        fontWeight: "600",
      },
      "variant:destructive": { backgroundColor: EDU.red600, color: EDU.white },
    },

    // Segmented toggle: borderless stone track, selected option a yellow pill
    "segmented-control": {
      base: {
        backgroundColor: EDU.paper2,
        borderRadius: "999px",
        padding: "3px",
      },
    },
    "segmented-control-item": {
      base: { borderRadius: "999px", fontWeight: "600" },
      selected: {
        backgroundColor: EDU.yellow,
        color: EDU.ink,
        boxShadow: "none",
      },
    },

    // Page title in the display face
    "top-nav-heading": {
      base: { fontFamily: "var(--font-family-heading)", fontWeight: "700" },
    },

    // Cards: white with the stronger --line-2 contour and a soft shadow
    card: {
      base: {
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: EDU.line2,
      },
    },

    // Chips: solid fills with AA text (edustyl "type chip")
    token: { base: { fontWeight: "500" }, ...hueChips("color") },
    badge: hueChips("variant"),

    // Bar track on deepest stone; fills in brand colours
    "progress-bar": {
      base: { "--color-background-muted": EDU.paper3 },
    },

    switch: {
      base: { "--color-background-gray": EDU.lineStrong },
    },
  },
});
