/** Junta o index.html, o JS e o CSS de dist-demo num único pavecad-demo.html. */
const fs = require('fs'), path = require('path');
const dir = path.resolve(__dirname, '../../dist-demo');
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const ler = (rel) => fs.readFileSync(path.join(dir, rel.replace(/^\.?\//, '')), 'utf8');
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => `<script type="module">\n${ler(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);
html = html.replace(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+)"[^>]*>/g, (_, href) => `<style>\n${ler(href)}\n</style>`);
// ícones: favicon embutido; o resto (apple-touch-icon, manifest) não é preciso aqui
const fav = path.join(dir, 'favicon.svg');
html = html.replace(/<link rel="icon"[^>]*>/, fs.existsSync(fav) ? `<link rel="icon" href="data:image/svg+xml;base64,${fs.readFileSync(fav).toString('base64')}">` : '');
html = html.replace(/<link rel="apple-touch-icon"[^>]*>/, '').replace(/<link rel="manifest"[^>]*>/, '');
const out = path.join(dir, 'pavecad-demo.html');
fs.writeFileSync(out, html);
console.log(`${out}  ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB`);
