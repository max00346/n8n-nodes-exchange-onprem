'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'),
  pkg = require('../package.json');
for (const file of [
  'README.md',
  'LICENSE',
  'NOTICE',
  'SECURITY.md',
  'CHANGELOG.md',
  'docs/OPERATIONS.md',
  'docs/FEATURE_MATRIX.md',
  'docs/AUDIT.md',
])
  assert.ok(fs.existsSync(path.join(root, file)), `Missing ${file}`);
for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
  const name = path.basename(file).split('.')[0];
  const instance = new (require(path.join(root, file))[name])();
  assert.ok(instance.description || instance.properties);
  if (file.includes('/credentials/'))
    for (const field of [
      'endpoint',
      'username',
      'domain',
      'mailbox',
      'password',
      'accessToken',
      'responseSigningSecret',
      'caCertificate',
    ])
      assert.equal(
        instance.properties.find((p) => p.name === field)?.default,
        '',
        `Credential default must be blank: ${field}`,
      );
}
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
for (const file of ['src', 'docs', 'examples', 'scripts'].flatMap((v) =>
  files(path.join(root, v)),
)) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(
    !/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text),
    'Possible token in release',
  );
  assert.ok(!/rejectUnauthorized\s*:\s*false/.test(text), 'TLS bypass in release');
}
for (const file of files(path.join(root, 'examples')).filter((v) => v.endsWith('.json'))) {
  const w = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(w.active, false);
  const names = new Set(w.nodes.map((n) => n.name));
  for (const n of w.nodes) {
    assert.ok(!n.credentials, `Credentials in example ${file}`);
    if (n.type.includes('exchange'))
      assert.ok(n.parameters.confirm !== true, `Write-enabled example ${file}`);
  }
  for (const [source, outputs] of Object.entries(w.connections)) {
    assert.ok(names.has(source));
    for (const slots of Object.values(outputs))
      for (const entries of slots) for (const entry of entries) assert.ok(names.has(entry.node));
  }
}
console.log(
  'Release checks passed: files, exports, generic source, token scan and inactive credential-free examples.',
);
