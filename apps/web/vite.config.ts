import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({ root: path.resolve(import.meta.dirname), envDir: path.resolve(import.meta.dirname, '../..'), plugins: [react()], build: { outDir: 'dist', emptyOutDir: true }, server: { proxy: { '/api': 'http://127.0.0.1:3001', '/socket.io': { target: 'http://127.0.0.1:3001', ws: true } } } });
