import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
    fs: { allow: ['..'] }, // ../shared/cloud_icons.json is shared with the backend
  },
})
