import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite bundles the app and enables fast HMR during development.
 * The React plugin wires in the automatic JSX runtime and Fast Refresh.
 */
export default defineConfig({
  plugins: [react()],
})
