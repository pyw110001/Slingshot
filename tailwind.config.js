/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace']
      },
      colors: {
        graphite: {
          950: '#050a0d',
          900: '#071014',
          850: '#0b171d',
          800: '#101f26',
          700: '#172b34'
        }
      },
      boxShadow: {
        glow: '0 0 28px rgba(38, 236, 221, 0.16)',
        amber: '0 0 26px rgba(255, 181, 54, 0.18)'
      }
    }
  },
  plugins: []
};
