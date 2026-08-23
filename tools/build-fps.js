// Inlines every dependency of fps/index.html into one self-contained
// gta-fun.html, so the game runs by double-clicking it with no server.
//
//   node tools/build-fps.js [extra output path ...]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'fps', 'index.html');
const OUT = path.join(ROOT, 'gta-fun.html');

let html = fs.readFileSync(SRC, 'utf8');

const tags = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)];
if (!tags.length) throw new Error('nothing to inline — no <script src> tags found');

for (const [tag, src] of tags) {
  const file = path.join(ROOT, 'fps', src);
  const code = fs.readFileSync(file, 'utf8')
    // A literal </script> inside a string would close the tag early.
    .replace(/<\/script>/gi, '<\\/script>');
  const block = `<script>\n/* ${src} */\n${code}\n</script>`;
  // The replacement MUST be a function. As a string, $' and $& are special:
  // sim.js contains say('+$' + ...), and that $' spliced the whole rest of the
  // document into the middle of the script, closing the tag early and dumping
  // the remaining JavaScript onto the page as text.
  html = html.replace(tag, () => block);
  console.log(`  inlined ${src.padEnd(22)} ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
}

if (/<script src=/.test(html)) throw new Error('a script tag survived inlining');

const outputs = [OUT, ...process.argv.slice(2)];
for (const out of outputs) {
  fs.writeFileSync(out, html);
  console.log(`wrote ${out} (${(html.length / 1024 / 1024).toFixed(2)}MB)`);
}
