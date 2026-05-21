/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        apple: {
          bg: '#f5f5f7',
          card: '#ffffff',
          sidebar: 'rgba(255,255,255,0.72)',
          accent: '#0071e3',
          'accent-light': 'rgba(0,113,227,0.08)',
          heading: '#1d1d1f',
          body: '#424245',
          secondary: '#86868b',
          tertiary: '#aeaeb2',
          'border-subtle': 'rgba(0,0,0,0.06)',
          'border-medium': 'rgba(0,0,0,0.08)',
          'border-input': 'rgba(0,0,0,0.1)',
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.04)',
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"',
          '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
