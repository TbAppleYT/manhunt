import type { Config } from 'tailwindcss';
// Colours map to the CSS tokens in proto.css so light/dark switching stays in one place.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { surface: 'var(--surface)', surface2: 'var(--surface-2)', text: 'var(--text)', text2: 'var(--text-2)', hider: 'var(--hider)', seeker: 'var(--seeker)' },
      fontFamily: { sans: ['Inter', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
