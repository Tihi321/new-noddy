import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/** `npm run dev:ui`: the renderer alone in a browser, against the fake engine (src/renderer/demo). Open it with `?demo`. */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: { port: 5199, strictPort: true },
  build: { chunkSizeWarningLimit: 2000 }
})
