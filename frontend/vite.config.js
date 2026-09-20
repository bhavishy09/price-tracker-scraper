import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config. The frontend talks to the Express backend at runtime via
// the URL in VITE_BACKEND_URL (defaults to the dev server proxy target).
// In production on Vercel, VITE_BACKEND_URL should point to the Render URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy /api to the backend during local dev so the frontend and
    // backend can run on different ports without CORS issues.
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
