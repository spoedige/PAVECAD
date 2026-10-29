import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Build de demonstração em um único .html (abre por duplo clique, sem servidor): sem service worker, worker embutido e todo o JS e CSS dentro do arquivo.
 *  Uso: npm run build:demo  (gera dist-demo/pavecad-demo.html). */
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'demo'; } })();

/** O worker das planilhas vira um blob dentro do próprio arquivo (o navegador não carrega worker de file://). */
const workerEmbutido: Plugin = {
  name: 'worker-embutido',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('src/mapa/cliente.ts')) return null;
    const a = "worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });";
    if (!code.includes(a)) throw new Error('cliente.ts mudou: ajuste vite.demo.config.ts');
    return "import WorkerEmbutido from './worker.ts?worker&inline';\n" + code.replace(a, 'worker = new WorkerEmbutido();');
  },
};

export default defineConfig({
  base: './',
  define: { __APP_COMMIT__: JSON.stringify(commit + '-demo'), __APP_DATA__: JSON.stringify(new Date().toISOString()) },
  resolve: { alias: { 'virtual:pwa-register': fileURLToPath(new URL('./scripts/demo/pwa-stub.ts', import.meta.url)) } },
  plugins: [workerEmbutido],
  build: { outDir: 'dist-demo', emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 100_000_000, rolldownOptions: { output: { codeSplitting: false } } },
});
