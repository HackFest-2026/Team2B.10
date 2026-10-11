/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0efff',
          100: '#e0dfff',
          200: '#c2bfff',
          300: '#a49fff',
          400: '#877fff',
          500: '#6c63ff',
          600: '#5a52e0',
          700: '#4840b8',
          800: '#362e8f',
          900: '#241c66',
        },
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
