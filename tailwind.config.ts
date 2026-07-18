import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        skyline: {
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
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
