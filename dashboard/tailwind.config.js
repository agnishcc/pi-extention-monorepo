/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#08080A',
        surface: '#111215',
        'surface-hover': '#18191E',
        card: '#141519',
        border: '#22232A',
        'border-light': '#2E2F38',
        linear: {
          brand: '#5E6AD2',
          'brand-hover': '#6E7AE6',
          muted: '#8F909A',
          subtle: '#585962',
          emerald: '#26B574',
          amber: '#F59E0B',
          rose: '#E5484D',
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
