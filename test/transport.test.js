'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHmac, createHash } = require('node:crypto');
const { send, post } = require('../dist/lib/transport');
const ntlm = require('../dist/lib/ntlm');
const { config } = require('../dist/lib/config');
const { execute } = require('../dist/lib/client');
const { credentials, envelope, draft } = require('./fixtures');
const SERVER_NONCE = Buffer.from('0123456789abcdef', 'hex'),
  TIMESTAMP = Buffer.from('0090d336b734c301', 'hex');
// Published MS-NLMP NTOWFv2(User, Password, Domain) vector, independent of implementation.
const RESPONSE_KEY = Buffer.from('0c868a403bfd7a93a3001ef22ef02e3f', 'hex');
function pair(id, data) {
  const b = Buffer.alloc(4);
  b.writeUInt16LE(id);
  b.writeUInt16LE(data.length, 2);
  return Buffer.concat([b, data]);
}
function type2() {
  const info = Buffer.concat([
    pair(1, Buffer.from('SERVER', 'utf16le')),
    pair(2, Buffer.from('Domain', 'utf16le')),
    pair(6, Buffer.from('02000000', 'hex')),
    pair(7, TIMESTAMP),
    Buffer.alloc(4),
  ]);
  const b = Buffer.alloc(56 + info.length);
  b.write('NTLMSSP\0');
  b.writeUInt32LE(2, 8);
  b.writeUInt32LE(0xa2888205, 20);
  SERVER_NONCE.copy(b, 24);
  b.writeUInt16LE(info.length, 40);
  b.writeUInt16LE(info.length, 42);
  b.writeUInt32LE(56, 44);
  Buffer.from([10, 0, 0x65, 0x4a, 0, 0, 0, 15]).copy(b, 48);
  info.copy(b, 56);
  return b;
}
function independentHmac(key, ...parts) {
  const h = createHmac('md5', key);
  for (const p of parts) h.update(p);
  return h.digest();
}
function sec(b, o) {
  return b.subarray(b.readUInt32LE(o + 4), b.readUInt32LE(o + 4) + b.readUInt16LE(o));
}
let temp, key, cert, der;
before(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ews-tls-'));
  fs.writeFileSync(
    path.join(temp, 'conf'),
    '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\n',
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-nodes',
      '-days',
      '1',
      '-config',
      path.join(temp, 'conf'),
      '-keyout',
      path.join(temp, 'key'),
      '-out',
      path.join(temp, 'cert'),
    ],
    { stdio: 'ignore' },
  );
  key = fs.readFileSync(path.join(temp, 'key'));
  cert = fs.readFileSync(path.join(temp, 'cert'));
  der = execFileSync('openssl', ['x509', '-in', path.join(temp, 'cert'), '-outform', 'DER']);
});
after(() => fs.rmSync(temp, { recursive: true, force: true }));
async function server(t, handler) {
  const s = https.createServer({ key, cert }, handler);
  await new Promise((resolve) => s.listen(0, 'localhost', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        s.closeAllConnections();
        s.close(resolve);
      }),
  );
  return {
    ...credentials,
    endpoint: `https://localhost:${s.address().port}/EWS/Exchange.asmx`,
    caCertificate: cert.toString(),
  };
}
function checkProof(type1, type3) {
  const nt = sec(type3, 20),
    lm = sec(type3, 12);
  assert.deepEqual(nt.subarray(24, 32), TIMESTAMP);
  assert.deepEqual(lm, Buffer.alloc(24));
  const proof = independentHmac(RESPONSE_KEY, SERVER_NONCE, nt.subarray(16));
  assert.deepEqual(nt.subarray(0, 16), proof);
  const sessionKey = independentHmac(RESPONSE_KEY, proof);
  const mic = Buffer.from(type3.subarray(72, 88));
  const zero = Buffer.from(type3);
  zero.fill(0, 72, 88);
  assert.deepEqual(mic, independentHmac(sessionKey, type1, type2(), zero));
  return nt;
}
test('NTLMv2 proof and MIC match independent HMAC plus Microsoft response-key vector', () => {
  const type1 = ntlm.negotiate(),
    type3 = ntlm.authenticate(type1, type2(), config(credentials), der, {
      nonce: Buffer.from('ffffff0011223344', 'hex'),
    });
  checkProof(type1, type3);
  assert.equal(sec(type3, 36).toString('utf16le'), 'User');
  assert.equal(sec(type3, 28).toString('utf16le'), 'Domain');
});
test('TLS channel binding hashes the server certificate as RFC5929 and GSS binding', () => {
  assert.equal(ntlm.certHashAlgorithm(der), 'sha256');
  const payload = Buffer.concat([
    Buffer.from('tls-server-end-point:'),
    createHash('sha256').update(der).digest(),
  ]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(payload.length, 16);
  assert.deepEqual(
    ntlm.channelBinding(der),
    createHash('md5').update(header).update(payload).digest(),
  );
  const b = ntlm.authenticate(ntlm.negotiate(), type2(), config(credentials), der);
  const info = ntlm.avPairs(sec(b, 20).subarray(44, -4));
  assert.deepEqual(info.get(10), ntlm.channelBinding(der));
  assert.equal(info.get(6).readUInt32LE(0) & 2, 2);
  assert.equal(info.get(9).toString('utf16le'), 'HTTP/mail.example.test');
});
test('secure client challenge differs between authentications; no NTLMv1 or malformed challenge', () => {
  const a = ntlm.authenticate(ntlm.negotiate(), type2(), config(credentials), der),
    b = ntlm.authenticate(ntlm.negotiate(), type2(), config(credentials), der);
  assert.notDeepEqual(sec(a, 20).subarray(32, 40), sec(b, 20).subarray(32, 40));
  for (const value of [Buffer.alloc(0), Buffer.alloc(100), Buffer.from(type2()).fill(0, 20, 24)])
    assert.throws(() => ntlm.challenge(value));
  assert.throws(() => ntlm.authenticate(ntlm.negotiate(), type2(), config(credentials)));
});
test('real TLS transport keeps socket and authenticates with MIC and CBT before EWS body', async (t) => {
  const calls = [];
  const c = await server(t, (req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      calls.push({
        socket: req.socket,
        body,
        auth: Buffer.from(req.headers.authorization.slice(5), 'base64'),
      });
      if (calls.length === 1) {
        res.writeHead(401, { 'WWW-Authenticate': 'Negotiate, NTLM ' + type2().toString('base64') });
        res.end();
      } else {
        res.end(draft());
      }
    });
  });
  const r = await execute(c, 'message.get', { itemId: 'item-id' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].socket, calls[1].socket);
  assert.equal(calls[0].body, '');
  assert.ok(calls[1].body.includes('<m:GetItem>'));
  checkProof(calls[0].auth, calls[1].auth);
  assert.equal(r.items[0].Body._, 'Grüße & Text');
});
test('Basic and bearer are explicit, single-request authentication modes', async (t) => {
  const headers = [];
  const c = await server(t, (req, res) => {
    headers.push(req.headers.authorization);
    req.resume();
    res.end(envelope(''));
  });
  await execute({ ...c, auth: 'basic' }, 'connection.test');
  await execute({ ...c, auth: 'bearer', accessToken: 'synthetic-token' }, 'connection.test');
  assert.equal(headers[0], 'Basic ' + Buffer.from('Domain\\User:Password').toString('base64'));
  assert.equal(headers[1], 'Bearer synthetic-token');
});
test('untrusted TLS never receives credentials', async (t) => {
  let calls = 0;
  const c = await server(t, (req, res) => {
    calls++;
    res.end();
  });
  await assert.rejects(
    execute({ ...c, caCertificate: '' }, 'connection.test'),
    (e) => e.code === 'NETWORK',
  );
  assert.equal(calls, 0);
});
test('redirect and auth rejection have no retries or secret-bearing errors', async () => {
  let calls = 0;
  await assert.rejects(
    send(
      credentials,
      { soapAction: 'test', xml: '<test/>' },
      {
        post: async () => {
          calls++;
          return { status: 302, headers: {} };
        },
      },
    ),
    (e) => e.code === 'REDIRECT',
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    send(
      { ...credentials, auth: 'basic' },
      { soapAction: 'test', xml: '<test/>' },
      {
        post: async () => {
          calls++;
          return { status: 401, headers: {} };
        },
      },
    ),
    (e) => e.code === 'AUTH' && !e.message.includes(credentials.password),
  );
  assert.equal(calls, 1);
});
test('NTLM cannot continue on a different socket', async (t) => {
  let calls = 0;
  const c = await server(t, (req, res) => {
    calls++;
    req.resume();
    res.writeHead(401, {
      'WWW-Authenticate': 'NTLM ' + type2().toString('base64'),
      Connection: 'close',
    });
    res.end();
  });
  await assert.rejects(execute(c, 'connection.test'), (e) => e.code === 'NTLM_CONNECTION');
  assert.equal(calls, 1);
});
test('timeout and response limit bound network resource use', async (t) => {
  const c = await server(t, (req, res) => {
    req.resume();
    if (req.headers.soapaction === '"large"') res.end(Buffer.alloc(2 * 1024 * 1024));
  });
  const agent = new https.Agent({ ca: cert });
  t.after(() => agent.destroy());
  await assert.rejects(
    post(new URL(c.endpoint), agent, 'test', '', 'hang', {
      timeoutMs: 20,
      maxBytes: 1024,
      mailbox: c.mailbox,
    }),
    (e) => e.code === 'TIMEOUT',
  );
  await assert.rejects(
    post(new URL(c.endpoint), agent, 'test', '', 'large', {
      timeoutMs: 1000,
      maxBytes: 1024,
      mailbox: c.mailbox,
    }),
    (e) => e.code === 'SIZE',
  );
});
test('Send and Wait sends once, exposes a POST form and validates the response', async (t) => {
  const bodies = [];
  const c = await server(t, (req, res) => {
    let text = '';
    req.on('data', (d) => (text += d));
    req.on('end', () => {
      bodies.push(text);
      res.end(envelope(''));
    });
  });
  c.auth = 'basic';
  const {
    ExchangeSendAndWait,
  } = require('../dist/nodes/ExchangeSendAndWait/ExchangeSendAndWait.node');
  const node = new ExchangeSendAndWait();
  const params = {
    to: 'recipient@example.test',
    subject: 'Approve <request>',
    message: 'Please review',
    responseType: 'approval',
    waitHours: 1,
    confirm: true,
  };
  let waits = 0;
  const shared = {
    getCredentials: async () => c,
    getExecutionId: () => 'execution-test',
    getNode: () => ({ id: 'node-test', name: 'Wait' }),
    getNodeParameter: (name, _index, fallback) => params[name] ?? fallback,
  };
  const result = await node.execute.call({
    ...shared,
    getInputData: () => [{ json: { original: true } }],
    evaluateExpression: () => 'https://n8n.example.test/webhook-waiting/execution-test',
    putExecutionToWait: async (date) => {
      assert.ok(date > Date.now());
      waits++;
    },
  });
  assert.equal(waits, 1);
  assert.equal(bodies.length, 1);
  assert.equal(result[0][0].json.response.status, 'timedOut');
  const { parse, find, scalar } = require('../dist/lib/xml');
  const html = scalar(find(parse(bodies[0]), 'Body').find((v) => v?.$?.BodyType === 'HTML'));
  const url = new URL(html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&'));
  assert.ok(url.pathname.endsWith('/execution-test/node-test'));
  const token = url.searchParams.get('token');
  const headers = {},
    res = {
      status(code) {
        this.code = code;
        return this;
      },
      type() {
        return this;
      },
      setHeader(k, v) {
        headers[k] = v;
      },
      send(value) {
        this.sent = value;
        return this;
      },
    };
  const ctx = {
    ...shared,
    getNodeParameter: (name, fallback) => params[name] ?? fallback,
    getResponseObject: () => res,
    getQueryData: () => ({ token }),
    getBodyData: () => ({}),
    getRequestObject: () => ({ method: 'GET' }),
  };
  const get = await node.webhook.call(ctx);
  assert.equal(get.workflowData, undefined);
  assert.ok(res.sent.includes('method="post"'));
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  const bad = await node.webhook.call({
    ...ctx,
    getRequestObject: () => ({ method: 'POST' }),
    getBodyData: () => ({ token: 'forged', approved: 'true' }),
  });
  assert.equal(bad.workflowData, undefined);
  assert.equal(res.code, 403);
  const good = await node.webhook.call({
    ...ctx,
    getRequestObject: () => ({ method: 'POST' }),
    getBodyData: () => ({ token, approved: 'true' }),
  });
  assert.equal(good.workflowData[0][0].json.response.approved, true);
  assert.equal(good.workflowData[0][0].json.response.status, 'received');
});
