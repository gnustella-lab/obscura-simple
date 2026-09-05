const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(reduced = false) {
  const cells = [], requests = [], intervals = new Map(), timeouts = new Map();
  let nextId = 0, flushes = 0;
  const grid = { appendChild: cell => cells.push(cell), get offsetWidth() { flushes++; return 800; } };
  const context = vm.createContext({
    console: { log() {} },
    document: {
      addEventListener() {},
      querySelector: () => grid,
      createElement() {
        const cell = { className: '', activations: 0, style: { setProperty(key,value) { this[key]=value; } } };
        cell.classList = {
          contains: name => cell.className.split(' ').includes(name),
          add(name) { this.toggle(name, true); },
          toggle(name, on) {
            const classes = new Set(cell.className.split(' ').filter(Boolean));
            if(name==='on' && on && !classes.has(name)) cell.activations++;
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
    flushes: () => flushes,
    on: () => cells.filter(cell => cell.classList.contains('on')),
    tick: () => [...intervals.values()].forEach(callback => callback()),
  };
}

test('click immediately starts CSS reveals with bottom rows scheduled before upper rows', () => {
  const h = setup();
  h.context.requestTunnel('startTunnel', { tunnelArgs: '{}' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.on().length, h.cells.filter(cell => !cell.classList.contains('empty')).length);
  const delays = Array.from({length: 5}, (_,row) => Number.parseFloat(h.cells[row*40].style['--pixel-delay']));
  assert.equal(delays[4], 0);
  for(let row=0;row<4;row++) assert(delays[row]>delays[row+1]);
  assert.equal(h.intervals.size, 0);
  h.context.syncPixelBackground();
  assert(h.on().length>0); // A stale disconnected status must not undo the click.
});

test('a fast connection does not restart or skip the CSS reveal', () => {
  const h = setup();
  h.context.requestTunnel('startTunnel');
  const flushes = h.flushes();
  h.run(`osStatus.serviceStatus.healthy.vpnStatus={connected:{}}; syncPixelBackground();`);
  assert.equal(h.flushes(), flushes);
  assert(h.on().every(cell=>cell.activations===1));
  assert.equal(h.timeouts.size, 0);
});

test('direct connected updates also activate delayed row reveals', () => {
  const h = setup();
  h.run(`osStatus.serviceStatus.healthy.vpnStatus={connected:{}}; syncPixelBackground();`);
  assert(h.on().every(cell=>cell.activations===1));
  assert(Number.parseFloat(h.cells[0].style['--pixel-delay'])>0);
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

test('replaying a connection resets CSS animation state without JS frame timers', () => {
  const h = setup();
  h.context.requestTunnel('startTunnel');
  assert.equal(h.intervals.size, 0);
  assert.equal(h.on().length, h.cells.filter(cell => !cell.classList.contains('empty')).length);
  h.context.renderPixelBackground(true,false,true);
  assert(h.on().every(cell=>cell.activations===2));
});
