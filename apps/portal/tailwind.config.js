/**
 * MCRC Portal design tokens (from design_handoff_accounting_portal/README.md
 * "Design Tokens"). Components reference these semantic names — never raw hex.
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16212c",
        navy: {
          DEFAULT: "#0e2a45", // primary
          hover: "#15395d",
          900: "#0b2239",
          800: "#0e2a45",
          700: "#10304f",
        },
        blue: {
          DEFAULT: "#2360c8", // links / active / focus
          light: "#8fbbe8",
          muted: "#8fa4ba",
          soft: "#9fb2c6",
        },
        gold: {
          DEFAULT: "#c0902f",
          deep: "#a3781f",
          soft: "#e6c87c",
          bright: "#c8a951",
        },
        paper: "#f6f2ea", // app bg
        sidebar: "#fbf8f1", // cream sidebar
        topbar: "#fffdf8",
        card: "#ffffff",
        line: {
          strong: "#e4dbc9",
          DEFAULT: "#efe8d8",
          divider: "#f2ecdf",
          input: "#d8cfbd",
        },
        content: {
          DEFAULT: "#16212c",
          secondary: "#5b6976",
          tertiary: "#3c4855",
          muted: "#8a94a0",
          placeholder: "#a5ad98",
        },
        // Status (fg / bg pairs)
        success: { DEFAULT: "#1f7a4d", bg: "#e3f0e8" },
        danger: { DEFAULT: "#b3372f", bg: "#faf0ee", "bg-2": "#fdf4f2", ink: "#7c2620" },
        warn: { DEFAULT: "#a3781f", bg: "#f9ecd0", "bg-2": "#f9f4e6" },
        info: { DEFAULT: "#2360c8", bg: "#eef3fb" },
        neutralchip: { DEFAULT: "#5b6976", bg: "#eee9dd" },
        vatchip: { DEFAULT: "#15395d", bg: "#e7eef6" },
        // hover row tint
        rowhover: "#fbf8f1",
      },
      fontFamily: {
        serif: ['"Newsreader"', "Georgia", "serif"],
        sans: ['"Hanken Grotesk"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "10px",
        modal: "14px",
        btn: "7px",
        input: "6px",
        chip: "99px",
      },
      boxShadow: {
        dropdown: "0 16px 40px rgba(14,33,44,.16)",
        modal: "0 32px 80px rgba(0,0,0,.35)",
      },
      backgroundImage: {
        "navy-hero": "radial-gradient(120% 100% at 20% 0%, #1a4570, #0e2a45 62%)",
        "navy-sidebar": "linear-gradient(180deg, #10304f, #0e2a45 55%, #0b2239)",
      },
      letterSpacing: {
        eyebrow: ".18em",
        eyebrowwide: ".24em",
      },
      keyframes: {
        "fade-rise": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        "fade-rise": "fade-rise 300ms ease-out",
        shimmer: "shimmer 1.4s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
