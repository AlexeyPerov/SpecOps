import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  // ESM preload (.mjs) breaks under `sandbox: true` ("Cannot use import statement outside a module").
  // Force CJS so Electron can run the preload bundle in the sandbox VM.
  preload: {
    build: {
      lib: {
        formats: ['cjs']
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html')
        }
      }
    }
  }
})
