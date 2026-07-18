/**
 * TwinTO's design tokens: deep navy/ink base, a calm blue for interactive
 * affordances, and TTC red reserved for brand accents (primary actions,
 * selected map elements) rather than every interactive surface.
 */
export const theme = {
  colors: {
    ink: "#0A0D14",
    panel: "rgba(15,19,28,0.82)",
    border: "rgba(255,255,255,0.08)",
    text: "#EDEFF3",
    muted: "#8B93A3",
    accent: "#5B8DEF",
    ttcRed: "#E0333B",
    amber: "#E3A83B",
    teal: "#3FBF9F",
    error: "#FF5C5C",
  },
} as const;

export type Theme = typeof theme;
