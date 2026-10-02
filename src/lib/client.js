'use strict';
const { config, authorize } = require('./config');
const { request, number } = require('./requests');
const { send } = require('./transport');
const { response, find, scalar } = require('./xml');
const { ExchangeError, fail } = require('./errors');
function parameters(value) {
  let p;
  try {
    p = typeof value === 'string' ? JSON.parse(value || '{}') : (value ?? {});
  } catch {
    fail('Parameters must be valid JSON.');
  }
  if (
    !p ||
    typeof p !== 'object' ||
    Array.isArray(p) ||
    JSON.stringify(p).length > 48 * 1024 * 1024
  )
    fail('Parameters must be a JSON object up to 48 MiB.');
  return p;
}
function collection(data, action) {
  if (action === 'attachment.getAll')
    return find(data, 'Attachments').flatMap((v) =>
      Object.entries(v || {})
        .filter(([k]) => k !== '$')
        .flatMap(([, v]) => (Array.isArray(v) ? v : [v])),
    );
  if (action.startsWith('attachment.'))
    return find(data, 'FileAttachment').concat(find(data, 'ItemAttachment'));
  const folders = action.startsWith('folder.') || action.startsWith('calendar.');
  const containers = find(data, folders ? 'Folders' : 'Items');
  return containers.flatMap((v) =>
    Object.entries(v || {})
      .filter(([k]) => k !== '$')
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v])),
  );
}
function streamingResponse(xml) {
  const envelopes = xml.match(/<(?:\w+:)?Envelope\b[\s\S]*?<\/(?:\w+:)?Envelope>/g);
  if (!envelopes?.length)
    throw new ExchangeError('XML', 'No complete streaming envelopes received.');
  return { data: { streamingResponses: envelopes.map((v) => response(v).data) }, paging: null };
}
async function execute(credentials, action, value = {}, sender = send) {
  const c = config(credentials),
    p = parameters(value);
  for (const k of ['returnAll', 'splitResults'])
    if (p[k] !== undefined && typeof p[k] !== 'boolean') fail(`${k} must be a boolean.`);
  let current = { ...p },
    page = 0;
  const pages = [],
    items = [];
  const maxPages = number(p.maxPages, 100, 1, 1000);
  do {
    const q = request(action, current, c);
    authorize(c, q.effects, p);
    if (q.preflight) {
      const before = response(
        await sender(credentials, request('message.get', { itemId: p.itemId }, c)),
      );
      const m = find(before.data, 'Message')[0];
      const id = m?.ItemId?.$;
      if (String(scalar(m?.IsDraft)) !== 'true')
        throw new ExchangeError(
          'DRAFT',
          'Only existing unsent drafts may be changed or sent with this operation.',
        );
      if (id?.Id !== p.itemId || id?.ChangeKey !== p.changeKey)
        throw new ExchangeError(
          'CONFLICT',
          'The draft changed. Read it again before updating or sending.',
        );
    }
    const text = await sender(credentials, q);
    const result = q.streaming ? streamingResponse(text) : response(text);
    pages.push(result);
    items.push(...collection(result.data, action));
    page++;
    if (!p.returnAll || !result.paging || result.paging.complete) break;
    if (action === 'event.getAll')
      throw new ExchangeError(
        'PAGING',
        'Calendar results are incomplete. Narrow the date window; calendar views do not support indexed paging.',
      );
    if (
      result.paging.nextOffset === null ||
      !Number.isInteger(result.paging.nextOffset) ||
      result.paging.nextOffset <= (current.offset || 0)
    )
      throw new ExchangeError('PAGING', 'Exchange returned an invalid continuation offset.');
    current.offset = result.paging.nextOffset;
  } while (page < maxPages);
  const last = pages.at(-1);
  return {
    account: c.mailbox,
    action,
    items,
    data: pages.length === 1 ? last.data : pages.map((v) => v.data),
    paging: last.paging,
    pages: page,
    complete: last.paging ? last.paging.complete : true,
    contentIsUntrusted: true,
  };
}
module.exports = { execute, parameters, collection, streamingResponse };
