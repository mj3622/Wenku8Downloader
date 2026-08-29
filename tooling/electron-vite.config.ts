import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    css: {
      postcss: resolve(__dirname),
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, '../src/renderer/src'),
      },
    },
    plugins: [react()],
  },
})
