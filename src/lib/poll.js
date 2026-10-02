'use strict';
const { execute } = require('./client');
const { find, scalar } = require('./xml');
const { ExchangeError } = require('./errors');
const { createHash } = require('node:crypto');
const { number } = require('./requests');
async function poll(credentials, params, state, client = execute) {
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        credentials.endpoint,
        credentials.mailbox,
        credentials.username,
        params.folderId || params.folder || 'inbox',
      ]),
    )
    .digest('hex');
  if (state.scope && state.scope !== scope) state = {};
  const next = { ...state, scope };
  let token = state.syncState;
  let initializing = state.initializing ?? (!token && params.emitExisting !== true);
  const changes = [];
  for (let page = 0; page < number(params.maxPages, 20, 1, 100); page++) {
    const r = await client(credentials, 'sync.items', {
      folderId: params.folderId || undefined,
      folder: params.folder || 'inbox',
      syncState: token,
      limit: 100,
    });
    const newToken = scalar(find(r.data, 'SyncState')[0]);
    if (typeof newToken !== 'string' || !newToken || newToken === token)
      throw new ExchangeError('SYNC', 'Exchange did not return a new synchronization state.');
    const complete = String(scalar(find(r.data, 'IncludesLastItemInRange')[0])) === 'true';
    if (!initializing)
      for (const container of find(r.data, 'Changes'))
        for (const [type, records] of Object.entries(container || {})) {
          if (type === '$') continue;
          for (const record of Array.isArray(records) ? records : [records])
            if (!params.changeType || params.changeType === 'all' || params.changeType === type)
              changes.push({
                changeType: type,
                data: record,
                account: credentials.mailbox,
                contentIsUntrusted: true,
              });
        }
    token = newToken;
    if (complete) {
      initializing = false;
      break;
    }
  }
  next.syncState = token;
  next.initializing = initializing;
  return { state: next, changes };
}
module.exports = { poll };
