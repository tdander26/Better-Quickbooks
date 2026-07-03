import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefdf3",
          100: "#d6f9e0",
          200: "#b0f1c6",
          300: "#79e4a5",
          400: "#3fce7f",
          500: "#18b463",
          600: "#0c924f",
          700: "#0b7442",
          800: "#0d5c37",
          900: "#0c4c2f",
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
