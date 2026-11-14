/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        vault: {
          bg: "#080c16",
          card: "#0d1527",
          cardHover: "#131e36",
          cardActive: "#192745",
          sidebar: "#060912",
          sidebarHover: "#0e1526",
          border: "#19243d",
          borderSubtle: "#121b30",
          text: "#f8fafc",
          muted: "#94a3b8",
          dim: "#64748b",
          blue: {
            DEFAULT: "#2563eb",
            hover: "#1d4ed8",
            glow: "rgba(37, 99, 235, 0.35)",
            light: "#60a5fa",
            dark: "#1e40af",
            subtle: "rgba(37, 99, 235, 0.15)",
          },
          accent: "#38bdf8",
          green: "#10b981",
          yellow: "#f59e0b",
          red: "#ef4444",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          '"Fira Code"',
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 20px -3px rgba(59, 130, 246, 0.3)",
        card: "0 4px 20px -2px rgba(0, 0, 0, 0.5)",
        floating: "0 10px 40px -5px rgba(0, 0, 0, 0.7)",
      },
      fontSize: {
        "2xs": ["10px", "14px"],
        xs: ["11px", "15px"],
        sm: ["12px", "16px"],
        base: ["13px", "18px"],
        md: ["14px", "20px"],
        lg: ["16px", "22px"],
        xl: ["18px", "24px"],
        "2xl": ["22px", "28px"],
      },
    },
  },
  plugins: [],
};

