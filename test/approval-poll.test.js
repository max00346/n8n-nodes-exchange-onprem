'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const a = require('../dist/lib/approval');
const { poll } = require('../dist/lib/poll');
const { credentials } = require('./fixtures');
test('signed response tokens bind execution, node and expiry', () => {
  const t = a.issue(credentials, 'exec', 'node', 2000);
  assert.equal(a.verify(credentials, t, 'exec', 'node', 1000), true);
  for (const [ex, node, now] of [
    ['other', 'node', 1000],
    ['exec', 'other', 1000],
    ['exec', 'node', 2001],
  ])
    assert.equal(a.verify(credentials, t, ex, node, now), false);
  assert.equal(
    a.verify(credentials, (t[0] === 'A' ? 'B' : 'A') + t.slice(1), 'exec', 'node', 1000),
    false,
  );
  assert.equal(a.verify(credentials, {}, 'exec', 'node', 1000), false);
  assert.throws(() => a.issue({ ...credentials, responseSigningSecret: '' }, 'e', 'n', 2000));
});
test('response form escapes HTML and never records a GET automatically', () => {
  const html = a.render('freeText', 'signed-token', [], '<script>x</script>');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('method="post"'));
  assert.ok(!html.includes('<script>'));
});
test('approval and custom responses validate fields without trusting extra payload', () => {
  assert.deepEqual(a.answer('approval', { approved: 'true' }, []), { approved: true });
  assert.throws(() => a.answer('approval', { approved: 'maybe' }, []));
  const fields = a.fields([
    { name: 'count', type: 'number', required: true },
    { name: 'choice', type: 'select', options: ['A', 'B'] },
  ]);
  assert.deepEqual(a.answer('customForm', { count: '3', choice: 'A', extra: 'ignored' }, fields), {
    count: 3,
    choice: 'A',
  });
  assert.throws(() => a.answer('customForm', { count: 'NaN' }, fields));
  assert.throws(() => a.fields([{ name: 'constructor', type: 'text' }]));
  assert.throws(() => a.answer('freeText', { response: 'x'.repeat(10001) }, []));
});
function sync(token, complete, type = 'Create') {
  return {
    data: {
      SyncState: token,
      IncludesLastItemInRange: String(complete),
      Changes: { [type]: { Message: { ItemId: { $: { Id: token } } } } },
    },
  };
}
test('first sync suppresses historical items across multiple polls', async () => {
  let r = await poll(credentials, { maxPages: 1 }, {}, async () => sync('first', false));
  assert.equal(r.changes.length, 0);
  assert.equal(r.state.initializing, true);
  r = await poll(credentials, { maxPages: 1 }, r.state, async () => sync('second', true));
  assert.equal(r.changes.length, 0);
  assert.equal(r.state.initializing, false);
  r = await poll(credentials, { maxPages: 1 }, r.state, async () => sync('third', true));
  assert.equal(r.changes.length, 1);
});
test('sync errors preserve previous state; filter does not lose continuation', async () => {
  const state = { syncState: 'old', initializing: false };
  await assert.rejects(
    poll(credentials, {}, state, async () => {
      throw new Error('failure');
    }),
  );
  assert.deepEqual(state, { syncState: 'old', initializing: false });
  const r = await poll(credentials, { changeType: 'Create' }, state, async () =>
    sync('new', true, 'Delete'),
  );
  assert.equal(r.changes.length, 0);
  assert.equal(r.state.syncState, 'new');
});
test('binary download emits n8n binary without base64 in JSON', async () => {
  const { output } = require('../dist/lib/node-helpers');
  const source = 'Grüße';
  let received;
  const r = await output(
    {
      helpers: {
        prepareBinaryData: async (b, fileName, mimeType) => {
          received = b.toString('utf8');
          return { data: 'storage-reference', fileName, mimeType };
        },
      },
    },
    {
      account: 'user@example.test',
      items: [
        {
          Name: '../../report.txt',
          Content: Buffer.from(source).toString('base64'),
          ContentType: 'text/plain',
        },
      ],
    },
    'attachment.download',
    2,
    {},
  );
  assert.equal(received, source);
  assert.equal(r[0].binary.data.fileName, 'report.txt');
  assert.equal(r[0].pairedItem.item, 2);
  assert.ok(!JSON.stringify(r[0].json).includes(Buffer.from(source).toString('base64')));
});
test('changing mailbox or folder resets the synchronization cursor', async () => {
  const prior = await poll(credentials, { maxPages: 1 }, {}, async () => sync('old', true));
  let received;
  const result = await poll(
    { ...credentials, mailbox: 'other@example.test' },
    { maxPages: 1 },
    prior.state,
    async (_c, _action, p) => {
      received = p;
      return sync('fresh', true);
    },
  );
  assert.equal(received.syncState, undefined);
  assert.equal(result.changes.length, 0);
  assert.notEqual(result.state.scope, prior.state.scope);
});
