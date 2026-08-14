/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readdir, readFile } from 'node:fs/promises'
import type { Plugin } from 'vite'
import { version } from './package.json'

const tldrawAssetDirectories = ['fonts', 'icons', 'translations', 'embed-icons']
const tldrawAssetRoot = path.resolve(__dirname, 'node_modules/@tldraw/assets')
const tldrawAssetPrefix = 'tldraw-assets'

function tldrawLocalAssets(): Plugin {
  const getContentType = (filePath: string) => {
    const extension = path.extname(filePath).toLowerCase()
    if (extension === '.svg') return 'image/svg+xml'
    if (extension === '.png') return 'image/png'
    if (extension === '.woff2') return 'font/woff2'
    if (extension === '.json') return 'application/json'
    return 'application/octet-stream'
  }

  const getAssetFiles = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      return entry.isDirectory() ? getAssetFiles(entryPath) : [entryPath]
    }))
    return files.flat()
  }

  return {
    name: 'tldraw-local-assets',
    configureServer(server) {
      server.middlewares.use(`/${tldrawAssetPrefix}`, async (request, response, next) => {
        const assetPath = decodeURIComponent(request.url ?? '/').split('?')[0].replace(/^[/\\]+/, '')
        const sourcePath = path.resolve(tldrawAssetRoot, assetPath)
        if (!sourcePath.startsWith(`${tldrawAssetRoot}${path.sep}`)) return next()

        try {
          response.setHeader('Content-Type', getContentType(sourcePath))
          response.end(await readFile(sourcePath))
        } catch {
          next()
        }
      })
    },
    async generateBundle() {
      const files = (await Promise.all(
        tldrawAssetDirectories.map((directory) => getAssetFiles(path.join(tldrawAssetRoot, directory))),
      )).flat()

      for (const filePath of files) {
        const relativePath = path.relative(tldrawAssetRoot, filePath).replaceAll('\\', '/')
        this.emitFile({
          type: 'asset',
          fileName: `${tldrawAssetPrefix}/${relativePath}`,
          source: await readFile(filePath),
        })
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tldrawLocalAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 21516,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco': ['monaco-editor', '@monaco-editor/react'],
          'vendor': ['react', 'react-dom', 'react-router-dom', 'zustand'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules', 'dist', 'e2e'],
  },
})
