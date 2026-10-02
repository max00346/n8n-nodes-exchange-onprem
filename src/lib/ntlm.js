'use strict';
// NTLMv2 connection-oriented HTTP authentication (MS-NLMP). No NTLMv1 fallback.
const { randomBytes, createHmac, createHash } = require('node:crypto');
const md4 = require('js-md4');
const { ExchangeError } = require('./errors');
const SIGNATURE = Buffer.from('NTLMSSP\0', 'ascii');
const FLAGS = 0xa2888205; // Unicode, target, NTLM, always-sign, ESS, target-info, version, 128/56.
const VERSION = Buffer.from([10, 0, 0x65, 0x4a, 0, 0, 0, 15]);
const hmac = (key, ...parts) => {
  const h = createHmac('md5', key);
  for (const part of parts) h.update(part);
  return h.digest();
};
function invalid() {
  throw new ExchangeError('NTLM', 'Invalid or unsupported NTLMv2 challenge.');
}
function negotiate() {
  const b = Buffer.alloc(40);
  SIGNATURE.copy(b);
  b.writeUInt32LE(1, 8);
  b.writeUInt32LE(FLAGS, 12);
  VERSION.copy(b, 32);
  return b;
}
function securityBuffer(b, offset, min) {
  if (offset + 8 > b.length) invalid();
  const length = b.readUInt16LE(offset),
    position = b.readUInt32LE(offset + 4);
  if (length && (position < min || position + length > b.length)) invalid();
  return b.subarray(position, position + length);
}
function avPairs(buffer) {
  const out = new Map();
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const id = buffer.readUInt16LE(offset),
      length = buffer.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + length > buffer.length || out.has(id)) invalid();
    if (id === 0) {
      if (length || offset !== buffer.length) invalid();
      return out;
    }
    out.set(id, buffer.subarray(offset, offset + length));
    offset += length;
  }
  invalid();
}
function packPairs(map) {
  const chunks = [];
  for (const [id, value] of map) {
    const b = Buffer.alloc(4);
    b.writeUInt16LE(id);
    b.writeUInt16LE(value.length, 2);
    chunks.push(b, value);
  }
  chunks.push(Buffer.alloc(4));
  return Buffer.concat(chunks);
}
function challenge(raw) {
  if (
    !Buffer.isBuffer(raw) ||
    raw.length < 48 ||
    raw.length > 16384 ||
    !raw.subarray(0, 8).equals(SIGNATURE) ||
    raw.readUInt32LE(8) !== 2
  )
    invalid();
  const flags = raw.readUInt32LE(20);
  if ((flags & 0x00880201) !== 0x00880201) invalid();
  const pairs = avPairs(securityBuffer(raw, 40, 48));
  if (
    (pairs.has(7) && pairs.get(7).length !== 8) ||
    (pairs.has(6) && pairs.get(6).length !== 4) ||
    (pairs.has(10) && pairs.get(10).length !== 16)
  )
    invalid();
  return { flags, nonce: raw.subarray(24, 32), pairs };
}
// Read certificate signature algorithm from DER; no dependency on OpenSSL CLI.
function der(buffer, offset = 0) {
  if (offset + 2 > buffer.length) invalid();
  const tag = buffer[offset++];
  let length = buffer[offset++];
  if (length & 128) {
    const bytes = length & 127;
    if (!bytes || bytes > 4 || offset + bytes > buffer.length) invalid();
    length = 0;
    for (let i = 0; i < bytes; i++) length = length * 256 + buffer[offset++];
  }
  if (offset + length > buffer.length) invalid();
  return {
    tag,
    start: offset,
    end: offset + length,
    bytes: buffer.subarray(offset, offset + length),
  };
}
function certHashAlgorithm(raw) {
  const outer = der(raw),
    tbs = der(raw, outer.start),
    alg = der(raw, tbs.end),
    oid = der(raw, alg.start);
  const hex = oid.bytes.toString('hex');
  const mapping = {
    '2a864886f70d010104': 'sha256',
    '2a864886f70d010105': 'sha256',
    '2a864886f70d01010b': 'sha256',
    '2a864886f70d01010c': 'sha384',
    '2a864886f70d01010d': 'sha512',
    '2a8648ce3d040302': 'sha256',
    '2a8648ce3d040303': 'sha384',
    '2a8648ce3d040304': 'sha512',
    '2a8648ce3d0401': 'sha256',
    '2b6570': 'sha256',
  };
  if (mapping[hex]) return mapping[hex];
  if (hex === '2a864886f70d01010a') {
    // RSA-PSS explicit hash algorithm, default SHA-1 -> SHA-256 (RFC 5929).
    if (oid.end === alg.end) return 'sha256';
    const params = der(raw, oid.end);
    let pos = params.start;
    while (pos < params.end) {
      const p = der(raw, pos);
      pos = p.end;
      if (p.tag === 0xa0) {
        const sequence = der(raw, p.start),
          hash = der(raw, sequence.start);
        const m = {
          '2b0e03021a': 'sha256',
          '608648016503040201': 'sha256',
          '608648016503040202': 'sha384',
          '608648016503040203': 'sha512',
        };
        if (m[hash.bytes.toString('hex')]) return m[hash.bytes.toString('hex')];
        invalid();
      }
    }
    return 'sha256';
  }
  throw new ExchangeError(
    'CBT',
    'Unsupported certificate signature algorithm for TLS channel binding.',
  );
}
function channelBinding(raw) {
  if (!Buffer.isBuffer(raw) || !raw.length)
    throw new ExchangeError('CBT', 'The peer certificate is required for TLS channel binding.');
  const endpoint = Buffer.concat([
    Buffer.from('tls-server-end-point:'),
    createHash(certHashAlgorithm(raw)).update(raw).digest(),
  ]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(endpoint.length, 16);
  return createHash('md5').update(header).update(endpoint).digest();
}
function authenticate(type1, type2, c, certificate, entropy = {}) {
  const ch = challenge(type2),
    pairs = new Map(ch.pairs);
  const flags = Buffer.alloc(4);
  flags.writeUInt32LE((pairs.get(6)?.readUInt32LE(0) || 0) | 2);
  pairs.set(6, flags);
  pairs.set(9, Buffer.from(c.servicePrincipal || `HTTP/${c.endpoint.hostname}`, 'utf16le'));
  if (c.channelBinding !== 'disabled') pairs.set(10, channelBinding(certificate));
  else pairs.delete(10);
  const nonce = entropy.nonce || randomBytes(8);
  if (nonce.length !== 8) invalid();
  const timestamp = ch.pairs.get(7) || Buffer.alloc(8);
  if (!ch.pairs.has(7))
    timestamp.writeBigUInt64LE((BigInt(entropy.now ?? Date.now()) + 11644473600000n) * 10000n);
  const passwordHash = Buffer.from(md4.arrayBuffer(Buffer.from(c.password, 'utf16le')));
  const responseKey = hmac(
    passwordHash,
    Buffer.from(c.username.toUpperCase() + c.domain, 'utf16le'),
  );
  passwordHash.fill(0);
  const blob = Buffer.concat([
    Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]),
    timestamp,
    nonce,
    Buffer.alloc(4),
    packPairs(pairs),
    Buffer.alloc(4),
  ]);
  const proof = hmac(responseKey, ch.nonce, blob),
    nt = Buffer.concat([proof, blob]);
  const lm = ch.pairs.has(7)
    ? Buffer.alloc(24)
    : Buffer.concat([hmac(responseKey, ch.nonce, nonce), nonce]);
  const sessionKey = hmac(responseKey, proof);
  responseKey.fill(0);
  const values = [
    lm,
    nt,
    Buffer.from(c.domain, 'utf16le'),
    Buffer.from(c.username, 'utf16le'),
    Buffer.from('N8N', 'utf16le'),
    Buffer.alloc(0),
  ];
  const b = Buffer.alloc(88 + values.reduce((n, v) => n + v.length, 0));
  SIGNATURE.copy(b);
  b.writeUInt32LE(3, 8);
  let position = 88;
  values.forEach((v, i) => {
    const offset = 12 + i * 8;
    b.writeUInt16LE(v.length, offset);
    b.writeUInt16LE(v.length, offset + 2);
    b.writeUInt32LE(position, offset + 4);
    v.copy(b, position);
    position += v.length;
  });
  b.writeUInt32LE((ch.flags & FLAGS) >>> 0, 60);
  if (ch.flags & 0x02000000) VERSION.copy(b, 64);
  hmac(sessionKey, type1, type2, b).copy(b, 72);
  sessionKey.fill(0);
  return b;
}
module.exports = {
  negotiate,
  challenge,
  authenticate,
  channelBinding,
  certHashAlgorithm,
  securityBuffer,
  avPairs,
  packPairs,
  hmac,
};
