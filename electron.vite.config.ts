import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: { '@renderer': resolve('src/renderer/src') }
    },
    server: { port: 5173, strictPort: true },
    plugins: [react()]
  }
})
