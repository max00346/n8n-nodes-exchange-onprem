'use strict';
const { ExchangeError } = require('./errors');
const versions = [
  'Exchange2007_SP1',
  'Exchange2010',
  'Exchange2010_SP1',
  'Exchange2010_SP2',
  'Exchange2013',
  'Exchange2013_SP1',
  'Exchange2016',
];
function config(input) {
  const c = { ...input };
  let url;
  try {
    url = new URL(c.endpoint);
  } catch {
    throw new ExchangeError('CONFIG', 'Enter a valid HTTPS EWS endpoint.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/\/ews\/exchange\.asmx$/i.test(url.pathname)
  )
    throw new ExchangeError(
      'CONFIG',
      'Use HTTPS ending in /EWS/Exchange.asmx, without credentials or URL parameters.',
    );
  c.endpoint = url;
  c.auth = c.auth || 'ntlm';
  c.domain = String(c.domain || '');
  c.username = String(c.username || '');
  c.mailbox = String(c.mailbox || '');
  if (!['ntlm', 'basic', 'bearer'].includes(c.auth))
    throw new ExchangeError('CONFIG', 'Unsupported authentication method.');
  if (
    c.auth !== 'bearer' &&
    (!c.username ||
      !c.password ||
      /[\x00-\x1f\\/]/.test(c.username) ||
      c.username.length > 256 ||
      c.domain.length > 256)
  )
    throw new ExchangeError(
      'CONFIG',
      'Enter username and password; enter the Windows domain separately.',
    );
  if (
    c.auth === 'bearer' &&
    (typeof c.accessToken !== 'string' || !c.accessToken || /[\r\n]/.test(c.accessToken))
  )
    throw new ExchangeError('CONFIG', 'A valid bearer token is required.');
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(c.mailbox))
    throw new ExchangeError('CONFIG', 'Enter the target mailbox SMTP address.');
  c.serverVersion = c.serverVersion || 'Exchange2013_SP1';
  if (!versions.includes(c.serverVersion))
    throw new ExchangeError('CONFIG', 'Unsupported EWS schema version.');
  c.timeZone = c.timeZone || 'UTC';
  c.timeoutMs = Number(c.timeoutMs || 60000);
  c.maxResponseMB = Number(c.maxResponseMB || 32);
  if (
    !Number.isInteger(c.timeoutMs) ||
    c.timeoutMs < 1000 ||
    c.timeoutMs > 1800000 ||
    !Number.isInteger(c.maxResponseMB) ||
    c.maxResponseMB < 1 ||
    c.maxResponseMB > 128
  )
    throw new ExchangeError('CONFIG', 'Timeout or response size is out of range.');
  for (const key of [
    'allowWrites',
    'allowSend',
    'allowDelete',
    'allowAdmin',
    'allowAdvanced',
    'impersonate',
  ])
    c[key] = c[key] === true;
  if (c.impersonate && !c.allowAdmin)
    throw new ExchangeError(
      'POLICY',
      'Impersonation requires administrative operations to be enabled in this credential.',
    );
  c.channelBinding = c.channelBinding || 'required';
  if (!['required', 'disabled'].includes(c.channelBinding))
    throw new ExchangeError('CONFIG', 'Invalid channel-binding setting.');
  return c;
}
function authorize(c, effects, p) {
  for (const e of effects) {
    const flag = {
      write: 'allowWrites',
      send: 'allowSend',
      delete: 'allowDelete',
      admin: 'allowAdmin',
      advanced: 'allowAdvanced',
    }[e];
    if (!c[flag])
      throw new ExchangeError('POLICY', `${e} operations are disabled in this credential.`);
  }
  if (effects.length && p.confirm !== true)
    throw new ExchangeError(
      'CONFIRM',
      'Set confirm to true only for an explicitly requested operation.',
    );
}
module.exports = { config, versions, authorize };
