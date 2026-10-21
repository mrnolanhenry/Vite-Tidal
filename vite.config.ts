// import react, { reactCompilerPreset } from '@vitejs/plugin-react'
// import babel from '@rolldown/plugin-babel'
// import { defineConfig } from 'vite'

// // https://vite.dev/config/
// export default defineConfig({
//   plugins: [
//     react(),
//     babel({ presets: [reactCompilerPreset()] })
//   ],
// })

// import { defineConfig } from "vite";
// import react from "@vitejs/plugin-react";

// export default defineConfig({
//   plugins: [react()],
//   server: { port: 5173, strictPort: true },
// });

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'; // or your respective framework plugin

export default defineConfig({
  plugins: [react()],
  base: '/Vite-Tidal/',
  server: {
    proxy: {
      '/api/tidal': {
        target: 'https://openapi.tidal.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tidal/, ''),
      },
    },
  },
});