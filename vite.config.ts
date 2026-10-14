import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode preview` produit un seul fichier HTML autonome (aperçu partageable, données de démo).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'preview' ? [react(), viteSingleFile()] : [react()],
  build: { outDir: mode === 'preview' ? 'dist-preview' : 'dist' },
}));
