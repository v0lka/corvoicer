import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  // Load env variables from .env files
  const env = loadEnv(mode, process.cwd(), '')
  const apiHost = env.VITE_API_HOST || 'localhost'
  const apiPort = env.VITE_API_PORT || '8080'
  const apiSecure = env.VITE_API_SECURE === 'true'
  const livekitHost = env.VITE_LIVEKIT_HOST || 'ws://localhost:7880'

  // SSL certificates for HTTPS development
  const certPath = resolve(__dirname, '.cert/cert.pem')
  const keyPath = resolve(__dirname, '.cert/key.pem')
  let https: { cert: string; key: string } | undefined

  try {
    https = {
      cert: readFileSync(certPath, 'utf-8'),
      key: readFileSync(keyPath, 'utf-8'),
    }
    console.log('[vite] HTTPS enabled')
  } catch {
    console.warn('[vite] HTTPS certificates not found at', certPath, 'and', keyPath)
    https = undefined
  }

  const apiProtocol = apiSecure ? 'https' : 'http'

  return {
    plugins: [react()],
    server: {
      host: true, // Listen on all addresses (for LAN access)
      https,
      proxy: {
        '/api': {
          target: `${apiProtocol}://${apiHost}:${apiPort}`,
          changeOrigin: true,
          secure: false, // Allow self-signed certificates
        },
        '/livekit': {
          target: livekitHost,
          ws: true,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/livekit/, ''),
        },
      },
    },
  }
})
