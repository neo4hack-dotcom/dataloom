/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        loom: {
          50: '#f0f9f3', 100: '#dbf2e4', 200: '#b2e2c5', 300: '#80cf9e',
          400: '#40b76e', 500: '#009f3d', 600: '#008934', 700: '#00722c',
          800: '#005c23', 900: '#00461b', 950: '#002d11',
        },
        flame: {
          50: '#fff6f0', 100: '#ffeadb', 200: '#ffd1b2', 300: '#ffb280',
          400: '#ff8c40', 500: '#ff6600', 600: '#db5800', 700: '#b84900',
          800: '#943b00', 900: '#702d00', 950: '#471d00',
        },
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pulse-ring': { '0%': { transform: 'scale(.9)', opacity: '.7' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
        'shimmer': { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .25s ease-out',
        'pulse-ring': 'pulse-ring 1.4s ease-out infinite',
        'shimmer': 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
};
