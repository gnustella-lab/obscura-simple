const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const context = vm.createContext({ window: {}, document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, 'utf8'), context);

test('Simple identifies its own app and never directs recovery to the official service', () => {
  const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
  const js = fs.readFileSync(`${__dirname}/app.js`, 'utf8');
  assert.match(html, /<title>Obscura Simple<\/title>/);
  assert.match(html, /not the official Obscura app/);
  assert.match(html, /gnustella-lab\/obscura-simple\/issues/);
  assert.match(html, /Only one VPN backend can run at a time/);
  assert.doesNotMatch(html + js, /\bobscura\.service\b/);
  assert.doesNotMatch(html + js, /flatpak/i);
  assert.match(js, /Welcome to Obscura Simple/);
});

test('the native single-package GUI forwards host integration actions to its bridge', async () => {
  const calls = [];
  const sandbox = vm.createContext({
    document: { addEventListener() {} },
    window: { webkit: { messageHandlers: { commandBridge: {
      postMessage(json) { calls.push(JSON.parse(json)); return '{}'; }
    } } } },
    console: { log() {} }
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, 'utf8'), sandbox);
  for (const command of ['restartService', 'linuxAddOperator', 'registerAsLoginItem', 'unregisterAsLoginItem', 'debugBundle']) {
    await sandbox.invoke(command);
  }
  assert.deepEqual(calls.map(call => Object.keys(call)[0]), [
    'restartService', 'linuxAddOperator', 'registerAsLoginItem', 'unregisterAsLoginItem', 'debugBundle'
  ]);
});

test('disconnected traffic is classified using acknowledged protection', () => {
  assert.equal(context.connectionProtection({ disconnected: {} }, 'blocking').detail, 'Internet blocked by kill switch');
  assert.equal(context.connectionProtection({ disconnected: {} }, 'inactive').detail, 'Traffic is vulnerable');
  for (const status of ['unknown', 'applying', 'failed', undefined]) {
    assert.equal(context.connectionProtection({ disconnected: {} }, status).detail, 'Protection not confirmed');
  }
});

test('a connected tunnel does not hide firewall failure', () => {
  assert.equal(context.connectionProtection({ connected: {} }, 'blocking').detail, 'Traffic is protected');
  assert.equal(context.connectionProtection({ connected: {} }, 'failed').state, 'unknown');
  assert.match(context.connectionProtection({ connected: {} }, 'failed').detail, /not confirmed/);
});

test('connecting copy distinguishes blocking from pending protection', () => {
  assert.equal(context.connectionProtection({ connecting: {} }, 'blocking').detail, 'Internet blocked while connecting');
  assert.equal(context.connectionProtection({ connecting: {} }, 'unknown').detail, 'Establishing VPN protection');
});

test('quick connect reports the actual exit city rather than requiring a city selection', () => {
  const city = context.getCityFromStatus({ connected: { exit: { country_code: 'jp', city_code: 'tyo' }, tunnelArgs: { exit: { any: {} } } } });
  assert.equal(city.country_code, 'jp');
  assert.equal(city.city_code, 'tyo');
});
