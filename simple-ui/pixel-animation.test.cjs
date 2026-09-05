const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(reduced = false) {
  const cells = [], requests = [], intervals = new Map(), timeouts = new Map();
  let nextId = 0;
  const context = vm.createContext({
    console: { log() {} },
    document: {
      addEventListener() {},
      querySelector: () => ({ appendChild: cell => cells.push(cell) }),
      createElement() {
        const cell = { className: '' };
        cell.classList = {
          contains: name => cell.className.split(' ').includes(name),
          add(name) { this.toggle(name, true); },
          toggle(name, on) {
            const classes = new Set(cell.className.split(' ').filter(Boolean));
            on ? classes.add(name) : classes.delete(name);
            cell.className = [...classes].join(' ');
          },
        };
        return cell;
      },
    },
    window: {
      matchMedia: () => ({ matches: reduced }),
      webkit: { messageHandlers: { commandBridge: {
        postMessage: command => new Promise((resolve, reject) => requests.push({ command: JSON.parse(command), resolve, reject })),
      } } },
    },
    setInterval: callback => { const id = ++nextId; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: callback => { const id = ++nextId; timeouts.set(id, callback); return id; },
    clearTimeout: id => timeouts.delete(id),
  });
  const run = code => vm.runInContext(code, context);
  run(fs.readFileSync(`${__dirname}/app.js`, 'utf8'));
  run(`buildPixelGrid(); osStatus={serviceStatus:{healthy:{vpnStatus:{disconnected:{}}}}}; syncPixelBackground();`);
  return { context, run, cells, requests, intervals, timeouts,
    on: () => cells.filter(cell => cell.classList.contains('on')),
    tick: () => [...intervals.values()].forEach(callback => callback()),
  };
}

test('click intent starts immediately and fills strictly from bottom rows to top', () => {
  const h = setup();
  h.context.requestTunnel('startTunnel', { tunnelArgs: '{}' });
  assert.equal(h.requests.length, 1);
  assert(h.on().length > 0);
  assert(h.on().every(cell => h.cells.indexOf(cell) >= 160));
  h.context.syncPixelBackground(); // A stale disconnected status must not undo the click.
  assert(h.on().length > 0);
  for (let tick = 0; tick < 25; tick++) {
    for (const cell of h.on()) {
      const row = Math.floor(h.cells.indexOf(cell) / 40);
      assert(h.cells.slice((row + 1) * 40).every(lower => lower.classList.contains('empty') || lower.classList.contains('on')));
    }
    h.tick();
  }
  assert.equal(h.on().length, h.cells.filter(cell => !cell.classList.contains('empty')).length);
  assert.equal(h.intervals.size, 0);
});

test('a fast connection preserves the remaining fill instead of jumping to all orange', () => {
  const h = setup();
  h.context.requestTunnel('startTunnel');
  const count = h.on().length;
  h.run(`osStatus.serviceStatus.healthy.vpnStatus={connected:{}}; syncPixelBackground();`);
  assert.equal(h.on().length, count);
  assert.equal(h.intervals.size, 1);
  for (let i = 0; i < 25; i++) h.tick();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
});

test('cancel clears pixels immediately and a late start failure cannot undo cancellation', async () => {
  const h = setup();
  const start = h.context.requestTunnel('startTunnel');
  const rejection = assert.rejects(start, /cancelled/);
  h.context.requestTunnel('stopTunnel');
  h.run(`osStatus.serviceStatus.healthy.vpnStatus={connecting:{}}; syncPixelBackground();`);
  assert.equal(h.on().length, 0);
  assert.equal(h.intervals.size, 0);
  h.requests[0].reject(new Error('cancelled'));
  await rejection;
  assert.equal(h.on().length, 0);
  assert(h.run('pixelRequest !== null && !pixelRequest.connect'));
});

test('request failures and missing status acknowledgement return to the actual state', async () => {
  const h = setup();
  const start = h.context.requestTunnel('startTunnel');
  h.requests[0].reject(new Error('unavailable'));
  await assert.rejects(start, /unavailable/);
  assert.equal(h.on().length, 0);
  assert.equal(h.intervals.size, 0);
  h.context.requestTunnel('startTunnel');
  [...h.timeouts.values()].forEach(callback => callback());
  assert.equal(h.on().length, 0);
  assert.equal(h.intervals.size, 0);
});

test('reduced motion skips the progressive fill', () => {
  const h = setup(true);
  h.context.requestTunnel('startTunnel');
  assert.equal(h.intervals.size, 0);
  assert.equal(h.on().length, h.cells.filter(cell => !cell.classList.contains('empty')).length);
});
