'use strict';
const { find, scalar } = require('./xml');
const { ExchangeError } = require('./errors');
async function output(context, result, action, index, params) {
  if (action === 'attachment.download' || action === 'message.exportMime') {
    const value =
      action === 'attachment.download' ? result.items[0] : find(result.data, 'MimeContent')[0];
    const encoded = action === 'attachment.download' ? scalar(value?.Content) : scalar(value);
    if (typeof encoded !== 'string')
      throw new ExchangeError(
        'BINARY',
        'No file or MIME content found. Embedded item attachments require Advanced EWS or the raw response.',
      );
    const filename = String(
      action === 'message.exportMime' ? 'message.eml' : scalar(value.Name) || 'attachment',
    )
      .replace(/.*[\\/]/, '')
      .replace(/[\x00-\x1f]/g, '_');
    const mime =
      action === 'message.exportMime'
        ? 'message/rfc822'
        : scalar(value.ContentType) || 'application/octet-stream';
    const buffer = Buffer.from(encoded, 'base64');
    return [
      {
        json: {
          account: result.account,
          action,
          fileName: filename,
          mimeType: mime,
          size: buffer.length,
          contentIsUntrusted: true,
        },
        binary: {
          [params.binaryProperty || 'data']: await context.helpers.prepareBinaryData(
            buffer,
            filename,
            mime,
          ),
        },
        pairedItem: { item: index },
      },
    ];
  }
  if (params.splitResults === true) {
    return result.items.map((item) => ({
      json: {
        account: result.account,
        action,
        data: item,
        paging: result.paging,
        complete: result.complete,
        contentIsUntrusted: true,
      },
      pairedItem: { item: index },
    }));
  }
  return [{ json: result, pairedItem: { item: index } }];
}
module.exports = { output };
