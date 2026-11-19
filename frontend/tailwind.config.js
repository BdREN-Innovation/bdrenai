/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Four-track sleeve: one flat saturated ground per product, white as the only relief colour.
        night: {
          DEFAULT: "#1846C9",
          deep: "#10319A",
          raised: "#2152D3",
          card: "#2B5BDB",
          line: "#4A72E0",
          edge: "#4A72E0",
          stroke: "#8AA5EE",
        },
        ink: "#14131C",
        ground: "#F5F6FB",
        line: "#DDE1EE",
        field: "#B5BCD3",
        muted: "#4A4E63",
        haze: "#DCE5FF",
        mist: "#DCE5FF",
        fog: "#EEF2FF",
        brand: {
          DEFAULT: "#14131C",
          strong: "#10319A",
          text: "#1846C9",
          glow: "#FFFFFF",
          tint: "#E8EEFF",
        },
        track: {
          synapse: "#1846C9",
          mindspear: "#0B7F80",
          mail: "#C92A5C",
          quigen: "#7B3FC4",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
        bengali: ["var(--font-bengali)", "sans-serif"],
      },
      maxWidth: {
        site: "1240px",
      },
    },
  },
  plugins: [],
};
