import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Single warm light theme (the handoff has no dark mode). Gate `dark:` on a
  // class that is never applied so OS dark preference can't desync the tokens.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Brand scale centered on the handoff accent green (#2A6B4F) so existing
        // `brand-*` utilities across the app resolve to the Ledger palette.
        brand: {
          50: "#e4eee8",
          100: "#cde0d6",
          200: "#a9cbbb",
          300: "#7fb199",
          400: "#4e8e72",
          500: "#2a6b4f",
          600: "#245c44",
          700: "#1e4b38",
          800: "#193d2e",
          900: "#122b21",
        },
        // Semantic aliases mapped to the CSS token layer.
        ink: "#1c1a17",
        accent: "#2a6b4f",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
