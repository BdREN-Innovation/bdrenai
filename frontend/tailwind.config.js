/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        night: {
          DEFAULT: "#06191D",
          raised: "#0E2A30",
          card: "#12323A",
          line: "#1A363C",
          edge: "#22434A",
          stroke: "#3A5A60",
        },
        ink: "#0A2328",
        ground: "#F5F7F6",
        line: "#DCE3E2",
        field: "#B9C6C5",
        muted: "#4A5C60",
        haze: "#A6B8BA",
        mist: "#B7C7C8",
        fog: "#D5E0DF",
        brand: {
          DEFAULT: "#C2501A",
          strong: "#8E3512",
          text: "#B4461A",
          glow: "#F08A4B",
          tint: "#FBEDE5",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-inter)", "sans-serif"],
        bengali: ["var(--font-bengali)", "sans-serif"],
      },
      maxWidth: {
        site: "1240px",
      },
    },
  },
  plugins: [],
};
