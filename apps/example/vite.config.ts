import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'mqtt-react-hooks': path.resolve(__dirname, '../../packages/mqtt-react-hooks/dist/index.js')
    }
  },
  server: { port: 5173 }
});
