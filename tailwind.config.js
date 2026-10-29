/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: { 50: '#FFFCF7', 100: '#FBF6EE', 200: '#F4EADB', 300: '#EADBC4' },
        tomato: { 50: '#FDEDE8', 100: '#FAD6CB', 400: '#EE6A47', 500: '#E2512F', 600: '#C63F20', 700: '#A1321A' },
        saffron: { 100: '#FDE9CF', 400: '#F5A54A', 500: '#F28C38' },
        charcoal: { 400: '#6B6862', 500: '#4A4844', 700: '#2F2D2A', 900: '#1F1E1C' },
        olive: { 50: '#F2F4E8', 100: '#E3E8CC', 400: '#8A9A55', 500: '#6B7A3A', 700: '#4C5729' },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        head: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(47,45,42,0.04), 0 8px 24px -12px rgba(47,45,42,0.18)',
        lift: '0 12px 40px -16px rgba(198,63,32,0.45)',
      },
      keyframes: {
        pop: { '0%': { transform: 'scale(.96)', opacity: 0 }, '100%': { transform: 'scale(1)', opacity: 1 } },
        flash: { '0%': { backgroundColor: 'rgba(242,140,56,0.35)' }, '100%': { backgroundColor: 'transparent' } },
        rise: { '0%': { transform: 'translateY(8px)', opacity: 0 }, '100%': { transform: 'translateY(0)', opacity: 1 } },
      },
      animation: {
        pop: 'pop .25s ease-out',
        flash: 'flash 2.4s ease-out',
        rise: 'rise .35s ease-out both',
      },
    },
  },
  plugins: [],
};
