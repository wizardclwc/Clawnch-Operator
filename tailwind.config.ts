import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#060913",
          900: "#0b1020",
          800: "#101a34",
          700: "#182447",
        },
        coral: {
          500: "#ff5a6b",
          600: "#ff3d51",
        },
      },
      boxShadow: {
        card: "0 18px 55px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
} satisfies Config;
