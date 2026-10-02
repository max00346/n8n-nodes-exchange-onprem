'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PackageDirectoryLoader } = require('n8n-core/dist/nodes-loader/package-directory-loader');
const { CustomDirectoryLoader } = require('n8n-core/dist/nodes-loader/custom-directory-loader');
const root = path.resolve(__dirname, '..');
for (const mode of ['package', 'custom'])
  test(`real n8n-core ${mode} loader recognizes all nodes, icons and credentials`, async () => {
    const loader =
      mode === 'package'
        ? new PackageDirectoryLoader(root)
        : new CustomDirectoryLoader(path.join(root, 'dist'));
    await loader.loadAll();
    assert.deepEqual(Object.keys(loader.known.nodes).sort(), [
      'exchangeOnPrem',
      'exchangeOnPremTrigger',
      'exchangeSendAndWait',
    ]);
    assert.deepEqual(Object.keys(loader.known.credentials), ['exchangeOnPrem']);
    for (const name of Object.keys(loader.known.nodes)) {
      const node = loader.getNode(name).type;
      assert.ok(node.description.properties.length);
      assert.ok(node.description.credentials.some((v) => v.name === 'exchangeOnPrem'));
    }
    const wait = loader.getNode('exchangeSendAndWait').type;
    assert.equal(wait.description.webhooks.length, 2);
    assert.ok(
      wait.description.webhooks.every(
        (w) => w.restartWebhook && w.isFullPath && w.path.includes('$nodeId'),
      ),
    );
  });
const baseline = {
  calendar: ['get', 'getAll', 'create', 'update', 'delete'],
  contact: ['get', 'getAll', 'create', 'update', 'delete'],
  draft: ['get', 'create', 'update', 'delete', 'send'],
  event: ['get', 'getAll', 'create', 'update', 'delete'],
  folder: ['get', 'getAll', 'create', 'update', 'delete'],
  folderMessage: ['getAll'],
  message: ['get', 'getAll', 'update', 'delete', 'move', 'reply', 'send'],
  attachment: ['get', 'getAll', 'download', 'add'],
};
test('Outlook v2 baseline action inventory has equivalent Exchange operations', () => {
  const { registry } = require('../dist/lib/requests');
  for (const [r, ops] of Object.entries(baseline))
    for (const op of ops) assert.ok(registry[r + '.' + op], r + '.' + op);
  const {
    ExchangeSendAndWait,
  } = require('../dist/nodes/ExchangeSendAndWait/ExchangeSendAndWait.node');
  assert.equal(typeof new ExchangeSendAndWait().execute, 'function');
});
