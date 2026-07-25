import type { Config } from "tailwindcss";

/**
 * Design system DealRadar — « terminal calme ».
 * Les couleurs vivent en variables CSS (globals.css) : le dark mode
 * est le mode natif, le light mode une projection.
 */
export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        body: "rgb(var(--body) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        signal: "rgb(var(--signal) / <alpha-value>)",
        up: "rgb(var(--up) / <alpha-value>)",
        down: "rgb(var(--down) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        data: ["var(--font-data)", "ui-monospace", "monospace"],
      },
      borderRadius: { DEFAULT: "0.5rem", lg: "0.75rem" },
    },
  },
  plugins: [],
} satisfies Config;
