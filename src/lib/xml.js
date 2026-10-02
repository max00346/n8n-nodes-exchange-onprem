'use strict';
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { ExchangeError, fail } = require('./errors');
const NS = {
  s: 'http://schemas.xmlsoap.org/soap/envelope/',
  m: 'http://schemas.microsoft.com/exchange/services/2006/messages',
  t: 'http://schemas.microsoft.com/exchange/services/2006/types',
};
const x = (value) => {
  const s = String(value);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) fail('XML control characters are not allowed.');
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
};
const tag = (name, value) => `<${name}>${x(value)}</${name}>`;
function validateXml(xml) {
  if (
    typeof xml !== 'string' ||
    xml.length > 64 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new ExchangeError('XML', 'Invalid XML or prohibited document/entity declaration.');
}
function parse(xml) {
  validateXml(xml);
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    attributesGroupName: '$',
    textNodeName: '_',
    parseTagValue: false,
    parseAttributeValue: false,
    removeNSPrefix: true,
    trimValues: false,
    processEntities: true,
  }).parse(xml);
}
function find(value, key, out = []) {
  if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (k === key) out.push(...(Array.isArray(v) ? v : [v]));
      find(v, key, out);
    }
  return out;
}
const scalar = (v) => (v && typeof v === 'object' ? v._ : v);
function response(xml) {
  const data = parse(xml);
  if (!data.Envelope?.Body)
    throw new ExchangeError('XML', 'A SOAP Envelope and Body are required.');
  const fault = find(data, 'Fault')[0];
  const codes = find(data, 'ResponseCode').map(scalar);
  if (fault || !codes.length || codes.some((c) => c !== 'NoError')) {
    const safeCodes = codes.filter((c) => typeof c === 'string' && /^[A-Za-z0-9_]+$/.test(c));
    const backoff = find(data, 'Value').find((v) => v?.$?.Name === 'BackOffMilliseconds');
    throw new ExchangeError(
      'EWS',
      safeCodes.length ? safeCodes.join(', ') : 'Unexpected SOAP response or fault.',
      { responseCodes: safeCodes, backoffMs: Number(scalar(backoff)) || null },
    );
  }
  const root = find(data, 'RootFolder')[0],
    attrs = root?.$ || {};
  const paging = root
    ? {
        complete: attrs.IncludesLastItemInRange === 'true',
        nextOffset:
          attrs.IndexedPagingOffset === undefined ? null : Number(attrs.IndexedPagingOffset),
        total: attrs.TotalItemsInView === undefined ? null : Number(attrs.TotalItemsInView),
      }
    : null;
  return { data, paging };
}
function envelope(body, c) {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="${NS.s}" xmlns:m="${NS.m}" xmlns:t="${NS.t}"><s:Header><t:RequestServerVersion Version="${x(c.serverVersion)}"/>${c.impersonate ? `<t:ExchangeImpersonation><t:ConnectingSID><t:PrimarySmtpAddress>${x(c.mailbox)}</t:PrimarySmtpAddress></t:ConnectingSID></t:ExchangeImpersonation>` : ''}${c.timeZone ? `<t:TimeZoneContext><t:TimeZoneDefinition Id="${x(c.timeZone)}"/></t:TimeZoneContext>` : ''}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
}
module.exports = { NS, x, tag, parse, validateXml, find, scalar, response, envelope };
