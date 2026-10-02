'use strict';
// Opt-in, read-only integration test. Never logs credentials, message bodies or raw errors.
const { execute } = require('../dist/lib/client');
const { safeError, ExchangeError } = require('../dist/lib/errors');
async function main() {
  if (process.env.EWS_LIVE_TEST !== 'yes')
    throw new ExchangeError(
      'CONFIG',
      'Set EWS_LIVE_TEST=yes and provide EWS_ENDPOINT, EWS_MAILBOX, EWS_USER, EWS_PASSWORD and optionally EWS_DOMAIN.',
    );
  const c = {
    endpoint: process.env.EWS_ENDPOINT,
    mailbox: process.env.EWS_MAILBOX,
    username: process.env.EWS_USER,
    password: process.env.EWS_PASSWORD,
    domain: process.env.EWS_DOMAIN || '',
    auth: process.env.EWS_AUTH || 'ntlm',
    accessToken: process.env.EWS_ACCESS_TOKEN,
    caCertificate: process.env.EWS_CA_PEM,
  };
  await execute(c, 'connection.test');
  const result = await execute(c, 'message.getAll', { limit: 1 });
  console.log(
    JSON.stringify({
      connection: 'passed',
      read: 'passed',
      itemsReturned: result.items.length,
      serverReportedComplete: result.complete,
    }),
  );
}
main().catch((e) => {
  console.error(safeError(e));
  process.exitCode = 1;
});
