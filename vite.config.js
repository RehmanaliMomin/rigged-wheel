import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Relative base so the build works at any path, including GitHub Pages' /rigged-wheel/.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
