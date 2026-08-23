// Visual check for GTA Fun: one headless browser, a sequence of screenshots,
// and a guaranteed kill of the whole browser process tree afterwards.
//
//   node tools/verify-fps.js <url> <outDir>
//
// Chrome spawns a tree of child processes; child.kill() only reaps the parent,
// which is how a pile of stray browsers builds up. taskkill /T handles the tree.
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const url = process.argv[2] || 'file:///C:/Users/miche/eskibidigames/gta-fun.html';
const outDir = process.argv[3] || '.';

const chrome = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if (!chrome) throw new Error('no Chrome or Edge found');

const port = 9300 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gtafun-verify-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const child = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--allow-file-access-from-files', '--hide-scrollbars', '--mute-audio',
  '--window-size=1280,720', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

const profileTag = path.basename(profile);

// Chrome re-parents its renderers, so killing the pid we spawned leaves a pile
// of orphans behind. Match on our unique profile directory instead: that only
// ever hits browsers this script started, never the user's own windows.
function cleanup() {
  try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { /* already gone */ }
  try {
    execSync('powershell -NoProfile -Command "' +
      "Get-CimInstance Win32_Process -Filter \\\"Name='chrome.exe'\\\" | " +
      `Where-Object { $_.CommandLine -like '*${profileTag}*' } | ` +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
      { stdio: 'ignore' });
  } catch (e) { /* nothing left to kill */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* fine */ }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

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
      send: (method, params) => new Promise((res, rej) => {
        const msgId = ++id;
        pending.set(msgId, { res, rej });
        ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
      }),
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
      } else if (msg.method) events.push(msg);
    });
  });
}

const CODES = {
  w: ['KeyW', 87], a: ['KeyA', 65], s: ['KeyS', 83], d: ['KeyD', 68], e: ['KeyE', 69],
  ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40],
};

(async () => {
  const cdp = await connect(await targetUrl());
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url });

  const evaluate = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  };

  const shoot = async name => {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, name + '.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`  ${name}.png  ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
  };

  const hold = async (keys, ms) => {
    for (const k of keys) {
      const [code, vk] = CODES[k];
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    }
    await sleep(ms);
    for (const k of keys) {
      const [code, vk] = CODES[k];
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    }
    await sleep(200);
  };

  // Wait for the models to finish parsing.
  console.log('loading…');
  for (let i = 0; i < 120; i++) {
    const ready = await evaluate('typeof S !== "undefined" && typeof scene !== "undefined" && scene.children.length > 50');
    if (ready) break;
    await sleep(500);
  }
  await evaluate('document.getElementById("start").style.display="none";document.getElementById("loading").style.display="none";started=true');
  await sleep(800);

  console.log('\nscreenshots:');
  await shoot('1-street');

  const yawBefore = await evaluate('S.player.yaw');
  await hold(['ArrowLeft'], 1400);
  const yawAfter = await evaluate('S.player.yaw');
  await shoot('2-turned-left');
  console.log(`  yaw ${yawBefore.toFixed(2)} -> ${yawAfter.toFixed(2)} after holding ArrowLeft`);

  // Get in the nearest car and drive, to check the chase camera.
  await evaluate(`
    (function () {
      var best = null, bd = 1e9;
      for (var i = 0; i < S.cars.length; i++) {
        var c = S.cars[i];
        var d = Math.hypot(c.x - S.player.x, c.z - S.player.z);
        if (c.parked && d < bd) { bd = d; best = c; }
      }
      S.player.x = best.x + 2; S.player.z = best.z + 2;
      game.interact();
      return S.player.driving;
    })()
  `);
  await sleep(600);
  await shoot('3-in-car');
  await hold(['ArrowUp'], 1600);
  await shoot('4-driving');
  await hold(['ArrowUp', 'ArrowLeft'], 1200);
  await shoot('5-driving-turn');

  // Bring the police out on foot, so their height and animation can be seen.
  await evaluate('game.interact(); game.raiseWanted(4); S.player.hasGun = true; S.player.ammo = 40; 1');
  await sleep(9000);
  // Face the nearest officer so their height and animation are actually visible.
  await evaluate(`
    (function () {
      var best = null, bd = 1e9;
      for (var i = 0; i < S.cops.length; i++) {
        var c = S.cops[i];
        var d = Math.hypot(c.x - S.player.x, c.z - S.player.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) S.player.yaw = Math.atan2(-(best.x - S.player.x), -(best.z - S.player.z));
      return bd;
    })()
  `);
  await sleep(500);
  const cops = await evaluate('S.cops.length');
  const policeCars = await evaluate('S.cars.filter(function(c){return c.kind==="police";}).length');
  await shoot('6-police');
  console.log(`  ${cops} officers on foot, ${policeCars} police cars at 4 stars`);

  // Put an officer squarely in front of the player, on a clear stretch of road,
  // so their height against the camera can actually be judged.
  const height = await evaluate(`
    (function () {
      S.player.x = 180; S.player.z = 180; S.player.yaw = 0;
      var cop = game.spawnCop(180, 174);
      S.cops.forEach(function (c) { if (c !== cop) { c.x = 40; c.z = 40; } });
      return MODEL_META.cop.h;
    })()
  `);
  await sleep(1500);
  await shoot('7-officer');
  console.log(`  officer model native height ${height}, drawn at 2.35m`);

  const logs = [];
  for (const ev of cdp.events) {
    if (ev.method === 'Runtime.exceptionThrown') {
      const d = ev.params.exceptionDetails;
      logs.push('EXCEPTION ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
    } else if (ev.method === 'Log.entryAdded' && ev.params.entry.level === 'error') {
      logs.push('ERROR ' + ev.params.entry.text);
    }
  }
  console.log(logs.length ? '\nerrors:\n  ' + logs.slice(0, 10).join('\n  ') : '\nno page errors');

  cdp.close();
  cleanup();
  process.exit(0);
})().catch(err => {
  console.error('failed:', err.message);
  cleanup();
  process.exit(1);
});
