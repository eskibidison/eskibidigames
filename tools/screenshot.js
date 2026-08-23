// Loads a page in headless Chrome and saves a screenshot, reporting anything
// the page logged or threw. Uses the DevTools protocol over Node's built-in
// WebSocket, so there is nothing to install.
//
//   node tools/screenshot.js <url> <out.png> [waitMs] [keys] [js]
//
// `keys` is an optional comma-separated list of keys to hold before the shot,
// e.g. "w,ArrowLeft". `js` is evaluated in the page first, which is how the
// pointer-lock overlay gets out of the way — headless cannot grab the mouse.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const url = process.argv[2];
const out = process.argv[3] || 'shot.png';
const waitMs = Number(process.argv[4] || 20000);
const keys = (process.argv[5] || '').split(',').filter(Boolean);
const evalJs = process.argv[6] || '';

if (!url) {
  console.error('usage: node tools/screenshot.js <url> <out.png> [waitMs] [keys]');
  process.exit(1);
}

const chrome = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if (!chrome) throw new Error('no Chrome or Edge found');

const port = 9222 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shotprofile-'));

const child = spawn(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  // Headless has no real GPU; SwiftShader gives us a working WebGL context.
  '--enable-unsafe-swiftshader',
  '--allow-file-access-from-files',
  '--hide-scrollbars',
  '--mute-audio',
  '--window-size=1280,720',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome never opened a debugging port');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];

    ws.addEventListener('open', () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
        });
      },
      events,
      close: () => ws.close(),
    }));
    ws.addEventListener('error', reject);
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    });
  });
}

function describe(arg) {
  if (arg.value !== undefined) return String(arg.value);
  if (arg.description) return arg.description;
  return arg.type;
}

(async () => {
  const cdp = await connect(await targetUrl());
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');

  await cdp.send('Page.navigate', { url });
  await sleep(waitMs);

  if (evalJs) {
    const res = await cdp.send('Runtime.evaluate', { expression: evalJs, returnByValue: true });
    if (res.exceptionDetails) {
      console.log('eval threw: ' + (res.exceptionDetails.exception || {}).description);
    }
    await sleep(600);
  }

  // Hold each key for a while so movement actually happens, then release.
  const CODES = {
    w: ['KeyW', 87], a: ['KeyA', 65], s: ['KeyS', 83], d: ['KeyD', 68], e: ['KeyE', 69],
    ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
    ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40],
  };
  for (const key of keys) {
    const [code, vk] = CODES[key] || [key, 0];
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: key, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  }
  if (keys.length) {
    await sleep(1500);
    for (const key of keys) {
      const [code, vk] = CODES[key] || [key, 0];
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: key, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      });
    }
    await sleep(400);
  }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

  const logs = [];
  for (const ev of cdp.events) {
    if (ev.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${ev.params.type}] ` + ev.params.args.map(describe).join(' '));
    } else if (ev.method === 'Runtime.exceptionThrown') {
      const d = ev.params.exceptionDetails;
      logs.push('[EXCEPTION] ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
    } else if (ev.method === 'Log.entryAdded' && ev.params.entry.level === 'error') {
      logs.push('[network/error] ' + ev.params.entry.text + ' ' + (ev.params.entry.url || ''));
    }
  }

  console.log(`screenshot: ${out} (${fs.statSync(out).size} bytes)`);
  if (logs.length) {
    console.log(`\nconsole (${logs.length} entries):`);
    for (const line of logs.slice(0, 40)) console.log('  ' + line.slice(0, 220));
  } else {
    console.log('console: clean');
  }

  cdp.close();
  child.kill();
  process.exit(0);
})().catch(err => {
  console.error('failed:', err.message);
  child.kill();
  process.exit(1);
});
