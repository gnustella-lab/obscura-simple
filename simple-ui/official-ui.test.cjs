const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const context = vm.createContext({ window: {}, document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, 'utf8'), context);

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
