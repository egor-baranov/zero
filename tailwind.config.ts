import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        shell: '0 22px 40px -30px rgba(25, 25, 25, 0.75)',
      },
    },
  },
  plugins: [],
};

export default config;
