const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const context = vm.createContext({ window: {}, document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(`${__dirname}/app.js`, 'utf8'), context);

test('firewall confirmation depends on applied status, not the saved preference', () => {
  for (const enabled of [true, false]) {
    vm.runInContext(`appStatus = { featureFlags: { killSwitch: ${enabled} } }`, context);
    assert.match(context.firewallStatusText('blocking'), /Firewall blocking/);
    assert.match(context.firewallStatusText('inactive'), /not active/);
    assert.match(context.firewallStatusText('failed'), /not confirmed/);
    assert.match(context.firewallStatusText('applying'), /Applying/);
    assert.match(context.firewallStatusText(undefined), /not been confirmed/);
    assert.match(context.firewallStatusText('unknown'), /not been confirmed/);
  }
});

test('settings render the reported firewall state alongside the saved preference', () => {
  const elements = new Map();
  context.document.querySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, { classList: { toggle() {} } });
    return elements.get(selector);
  };
  context.document.querySelectorAll = () => [];
  vm.runInContext(`
    osStatus = {};
    appStatus = { featureFlagKeys: ['killSwitch'], featureFlags: { killSwitch: true }, firewallStatus: 'failed' };
    renderSettings();
  `, context);
  assert.equal(elements.get('#toggleKillSwitch').checked, true);
  assert.match(elements.get('#killSwitchStatus').textContent, /Protection is not confirmed/);
  vm.runInContext("appStatus.firewallStatus = 'blocking'; renderSettings();", context);
  assert.match(elements.get('#killSwitchStatus').textContent, /Firewall blocking/);
});
