'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registry, request } = require('../dist/lib/requests');
const { config, authorize } = require('../dist/lib/config');
const { parse, find } = require('../dist/lib/xml');
const { execute } = require('../dist/lib/client');
const { credentials, parameters: p, envelope, draft } = require('./fixtures');
const c = config(credentials);
for (const action of Object.keys(registry))
  test(`operation ${action}: valid SOAP and credential-owned routing`, () => {
    const r = request(action, p, c);
    assert.ok(
      r.soapAction.startsWith('http://schemas.microsoft.com/exchange/services/2006/messages/'),
    );
    const xml = parse(r.xml);
    assert.ok(xml.Envelope.Body);
    assert.equal(find(xml, 'RequestServerVersion')[0].$.Version, 'Exchange2013_SP1');
    assert.ok(!r.xml.includes('<text>'));
    authorize(c, r.effects, p);
  });
test('advanced operations cover the 95-operation Microsoft reference', () => {
  const ops = require('../dist/lib/ews-operations.json');
  assert.equal(new Set(ops).size, 95);
  for (const op of [
    'GetStreamingEvents',
    'UpdateInboxRules',
    'AddDelegate',
    'UploadItems',
    'SearchMailboxes',
    'GetUserConfiguration',
  ])
    assert.ok(ops.includes(op));
});
test('reject invalid advanced XML, operation mismatch, envelope injection and entities', () => {
  for (const bodyXml of [
    '<m:SendItem/>',
    '<m:GetItem/><m:GetItem/>',
    '<s:Envelope/>',
    '<!DOCTYPE root><m:GetItem/>',
    '<m:GetItem><s:Header/></m:GetItem>',
  ])
    assert.throws(() => request('advanced.execute', { ...p, bodyXml }, c));
  assert.throws(() => request('advanced.execute', { ...p, ewsOperation: 'Unknown' }, c));
});
test('all mutating convenience operations are denied by default before network', async () => {
  let calls = 0;
  for (const [action, def] of Object.entries(registry)) {
    if (!def.effects.length) continue;
    await assert.rejects(
      execute(
        {
          ...credentials,
          allowWrites: false,
          allowSend: false,
          allowDelete: false,
          allowAdmin: false,
          allowAdvanced: false,
        },
        action,
        p,
        async () => {
          calls++;
          return envelope('');
        },
      ),
      (e) => e.code === 'POLICY',
    );
  }
  assert.equal(calls, 0);
});
test('send, delete, invitations and advanced execution have separate capabilities', () => {
  const read = config({
    ...credentials,
    allowWrites: true,
    allowSend: false,
    allowDelete: false,
    allowAdvanced: false,
  });
  for (const [action, params] of [
    ['message.send', p],
    ['message.delete', p],
    ['event.create', { ...p, invitations: 'SendToAllAndSaveCopy' }],
    ['advanced.execute', p],
  ]) {
    const r = request(action, params, read);
    assert.throws(() => authorize(read, r.effects, params));
  }
});
test('write confirmation is required; advanced authority is an explicit opt-in', async () => {
  await assert.rejects(
    execute(credentials, 'draft.create', { ...p, confirm: false }),
    (e) => e.code === 'CONFIRM',
  );
  const r = request(
    'advanced.execute',
    {
      ...p,
      ewsOperation: 'SendItem',
      bodyXml:
        '<m:SendItem SaveItemToFolder="true"><m:ItemIds><t:ItemId Id="i"/></m:ItemIds></m:SendItem>',
    },
    c,
  );
  assert.deepEqual(r.effects, ['advanced']);
});
test('credentials reject redirects-in-URL, HTTP, invalid user inputs and unchecked TLS', () => {
  for (const change of [
    { endpoint: 'http://mail.example.test/EWS/Exchange.asmx' },
    { endpoint: 'https://user:pass@mail.example.test/EWS/Exchange.asmx' },
    { endpoint: 'https://mail.example.test/EWS/Exchange.asmx?other=1' },
    { mailbox: 'invalid' },
    { username: 'Domain\\User' },
    { auth: 'auto' },
    { serverVersion: 'bogus' },
  ])
    assert.throws(() => config({ ...credentials, ...change }));
});
test('paged searches stop at the cap and expose incompleteness', async () => {
  let calls = 0;
  const r = await execute(
    credentials,
    'message.getAll',
    { returnAll: true, maxPages: 2 },
    async (_c, q) => {
      calls++;
      assert.ok(q.xml.includes(`Offset="${(calls - 1) * 100}"`));
      return envelope(
        `<m:RootFolder IncludesLastItemInRange="false" IndexedPagingOffset="${calls * 100}" TotalItemsInView="500"><t:Items><t:Message><t:ItemId Id="${calls}"/></t:Message></t:Items></m:RootFolder>`,
      );
    },
  );
  assert.equal(calls, 2);
  assert.equal(r.items.length, 2);
  assert.equal(r.complete, false);
  assert.equal(r.paging.nextOffset, 200);
});
test('invalid pagination cannot loop; calendar truncation is explicit', async () => {
  await assert.rejects(
    execute(credentials, 'message.getAll', { returnAll: true }, async () =>
      envelope('<m:RootFolder IncludesLastItemInRange="false" IndexedPagingOffset="0"/>'),
    ),
    (e) => e.code === 'PAGING',
  );
  await assert.rejects(
    execute(credentials, 'event.getAll', { ...p, returnAll: true }, async () =>
      envelope('<m:RootFolder IncludesLastItemInRange="false"/>'),
    ),
    (e) => e.code === 'PAGING',
  );
});
test('draft update and send preflight rejects stale/sent messages', async () => {
  for (const action of ['draft.update', 'draft.send'])
    for (const xml of [draft(false), draft(true, 'new')]) {
      let calls = 0;
      await assert.rejects(
        execute(credentials, action, p, async () => {
          calls++;
          return xml;
        }),
      );
      assert.equal(calls, 1);
    }
});
test('draft update checks once then writes with NeverOverwrite and SaveOnly', async () => {
  const calls = [];
  await execute(credentials, 'draft.update', p, async (_c, q) => {
    calls.push(q);
    return calls.length === 1 ? draft() : envelope('');
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].soapAction.endsWith('/GetItem'));
  assert.ok(calls[1].xml.includes('NeverOverwrite'));
  assert.ok(calls[1].xml.includes('SaveOnly'));
});
test('input constraints: MIME, times, recurrence, attachments, XML controls', () => {
  for (const [action, params] of [
    ['message.getAll', { limit: 1001 }],
    ['event.create', { ...p, end: p.start }],
    ['event.getAll', { ...p, start: '2026-10-02' }],
    ['event.create', { ...p, recurrence: { pattern: 'unknown' } }],
    ['attachment.add', { ...p, contentBase64: '@@@' }],
    ['draft.create', { ...p, body: '\x00' }],
  ])
    assert.throws(() => request(action, params, c));
});
test('recurring appointment has ordered recurrence and timezone', () => {
  const r = request(
    'event.create',
    {
      ...p,
      recurrence: { pattern: 'weekly', days: ['Monday'], startDate: '2026-10-02', count: 5 },
      startTimeZone: 'UTC',
    },
    c,
  );
  assert.ok(r.xml.indexOf('Recurrence>') < r.xml.indexOf('StartTimeZone'));
  assert.ok(r.xml.includes('<t:NumberOfOccurrences>5</t:NumberOfOccurrences>'));
});
test('SOAP faults, HTML pages, DTDs and partial EWS failures cannot appear successful', async () => {
  for (const xml of [
    '<html/>',
    '<!DOCTYPE a><a/>',
    envelope('').replace('NoError', 'ErrorAccessDenied'),
    envelope('<m:ResponseCode>ErrorInvalidChangeKey</m:ResponseCode>'),
  ])
    await assert.rejects(execute(credentials, 'message.get', p, async () => xml));
});
test('body contents are not rewritten when targeting another mailbox', () => {
  const r = request(
    'draft.create',
    { ...p, folderId: undefined, body: 'user@example.test' },
    config({ ...credentials, mailbox: 'shared@example.test' }),
  );
  assert.ok(r.xml.includes('<t:EmailAddress>shared@example.test</t:EmailAddress>'));
  assert.ok(r.xml.includes('>user@example.test</t:Body>'));
});
test('enabling automatic replies requires send permission; disabling does not', () => {
  const c = config({ ...credentials, allowSend: false });
  const enabled = request('settings.setOof', { state: 'Enabled', confirm: true }, c);
  assert.throws(() => authorize(c, enabled.effects, { confirm: true }));
  const disabled = request('settings.setOof', { state: 'Disabled', confirm: true }, c);
  assert.doesNotThrow(() => authorize(c, disabled.effects, { confirm: true }));
});
