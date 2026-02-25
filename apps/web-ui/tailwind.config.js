/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Space Grotesk"', 'sans-serif'],
      },
      colors: {
        ink: '#0b1220',
        haze: '#f1f4ff',
        accent: '#16a34a',
        dusk: '#1f2a44',
        ember: '#f97316',
      },
      boxShadow: {
        glow: '0 0 40px rgba(22, 163, 74, 0.25)'
      }
    },
  },
  plugins: [],
};
