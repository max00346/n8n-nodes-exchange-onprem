'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
assert.ok(process.argv.length <= 3, 'Usage: node scripts/verify-package.js [output-directory]');
const outputDirectory = process.argv[2] ? path.resolve(process.argv[2]) : null;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'exchange-package-check-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env };
delete env.NODE_PATH;
function run(command, args, cwd, expected = [0]) {
  const r = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180000,
  });
  assert.ok(!r.error, r.error?.message);
  assert.ok(expected.includes(r.status), `${command} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}
try {
  const pack = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', temporary], root))[0];
  const archive = path.join(temporary, pack.filename);
  assert.ok(pack.files.some((f) => f.path === 'dist/lib/ntlm.js'));
  assert.ok(pack.files.some((f) => f.path === 'docs/AUDIT.md'));
  assert.ok(
    pack.files.every(
      (f) => !/^(?:src|test|node_modules|\.git)\//.test(f.path) && !f.path.includes('.env'),
    ),
  );
  const consumer = path.join(temporary, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'exchange-isolated-package-check', version: '1.0.0', private: true }),
  );
  run(npm, ['install', '--ignore-scripts', '--no-fund', '--no-audit', archive], consumer);
  const pkgRoot = path.join(consumer, 'node_modules', 'n8n-nodes-exchange-onprem');
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.peerDependenciesMeta['n8n-workflow'].optional, true);
  assert.ok(!fs.existsSync(path.join(consumer, 'node_modules', 'n8n-workflow')));
  const probe = `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const root = ${JSON.stringify(pkgRoot)};
    const p = require(path.join(root, 'package.json'));
    for (const f of [...p.n8n.nodes, ...p.n8n.credentials]) {
      const name = path.basename(f).split('.')[0];
      const instance = new (require(path.join(root, f))[name])();
      assert.ok(instance.description || instance.properties);
    }
    const { nodeError, ExchangeError } = require(path.join(root, 'dist/lib/errors'));
    const error = nodeError({ name: 'Test' }, new ExchangeError('TEST', 'Safe message'));
    assert.equal(error.name, 'ExchangeNodeError');
    assert.equal(error.message, 'TEST: Safe message');
  `;
  run(process.execPath, ['-e', probe], consumer);
  const audit = JSON.parse(run(npm, ['audit', '--omit=dev', '--json'], consumer, [0, 1]));
  assert.ok(!audit.error, 'The consumer dependency audit did not complete.');
  assert.equal(audit.metadata.vulnerabilities.total, 0, 'Consumer dependency audit failed.');
  const report = {
    name: pkg.name,
    version: pkg.version,
    archiveFileCount: pack.files.length,
    archiveSha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    nodesLoaded: pkg.n8n.nodes.length,
    credentialsLoaded: pkg.n8n.credentials.length,
    isolatedInstall: true,
    secondN8nRuntimeInstalled: false,
    productionAudit: audit.metadata.vulnerabilities,
  };
  if (outputDirectory) {
    const sbom = JSON.parse(
      run(npm, ['sbom', '--omit=dev', '--sbom-format', 'cyclonedx'], consumer),
    );
    assert.ok(sbom.components.some((c) => c.name === 'fast-xml-parser'));
    assert.ok(sbom.components.some((c) => c.name === 'js-md4'));
    assert.ok(!sbom.components.some((c) => c.name === 'n8n-workflow'));
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.copyFileSync(archive, path.join(outputDirectory, pack.filename));
    for (const [file, data] of Object.entries({
      'consumer-production-audit.json': audit,
      'production-sbom.cdx.json': sbom,
      'package-install-check.json': report,
    }))
      fs.writeFileSync(path.join(outputDirectory, file), JSON.stringify(data, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
