import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Charcoal tinted toward the acceptance green, so panels and map
        // read as one surface.
        ink: "#0c0f10",
        "ink-bright": "#e8ede9",
        "ink-dim": "#cfd8d0",
        muted: "#98a29b",
        panel: "rgba(18, 22, 21, 0.92)",
        hairline: "rgba(226, 236, 228, 0.09)",
        oppose: "#db6055",
        support: "#38ad6b",
        // TechTO transit demo surface (TTC-adjacent charcoal + signal colors).
        techto: {
          ink: "#0b0d10",
          text: "#e8edf2",
          muted: "#8b95a1",
          accent: "#5b9fd4",
          red: "#c8102e",
          amber: "#e0a106",
          teal: "#2bb673",
          error: "#e35d6a",
        },
      },
      fontFamily: {
        ui: ["var(--font-ui)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
