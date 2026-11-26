import { defineConfig, loadEnv } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-bun'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({ serverOptions: { maxRequestBodySize: 105 * 1024 * 1024, idleTimeout: 60 } }),
      paths: {
        base: (loadEnv(mode, process.cwd()).VITE_BASE_PATH || '/').replace(/\/$/, '') as '' | `/${string}`,
        origin: loadEnv(mode, process.cwd(), '').FRONTEND_URL?.replace(/\/$/, '') || undefined,
      },
      files: { assets: 'public', serviceWorker: 'src/service-worker/index.ts' },
      serviceWorker: { register: false },
      compilerOptions: { experimental: { async: true } },
      experimental: { remoteFunctions: true },
    })
  ],
}))
