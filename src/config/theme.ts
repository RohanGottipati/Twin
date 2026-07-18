export const theme = {
  colors: {
    base: "#070A0F",
    panel: "rgba(8, 13, 21, 0.78)",
    border: "rgba(255, 255, 255, 0.10)",
    cyan: "#55D8E6",
    blue: "#6287FF",
    text: "#F5F7FA",
    muted: "#9AA7B5",
    warning: "#F4B860",
    error: "#FF6B6B",
  },
} as const;

export type Theme = typeof theme;
