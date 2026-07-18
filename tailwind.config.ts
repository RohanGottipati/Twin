import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        twinto: {
          ink: "#0A0D14",
          panel: "rgba(15,19,28,0.82)",
          border: "rgba(255,255,255,0.08)",
          text: "#EDEFF3",
          muted: "#8B93A3",
          accent: "#5B8DEF",
          red: "#E0333B",
          amber: "#E3A83B",
          teal: "#3FBF9F",
          error: "#FF5C5C",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
