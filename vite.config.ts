import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('jspdf')) return 'pdf'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('node_modules/react') || id.includes('node_modules/react-router')) return 'vendor'
        },
      },
    },
  },
})
