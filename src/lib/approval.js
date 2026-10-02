'use strict';
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { ExchangeError, fail } = require('./errors');
const { x } = require('./xml');
function key(credentials) {
  const value = credentials.responseSigningSecret;
  if (typeof value !== 'string' || value.length < 32)
    throw new ExchangeError(
      'CONFIG',
      'Send and Wait requires a separate random response-signing secret of at least 32 characters in the credential.',
    );
  return value;
}
function issue(credentials, executionId, nodeId, expires) {
  const payload = Buffer.from(
    JSON.stringify({ executionId, nodeId, expires, nonce: randomBytes(24).toString('base64url') }),
  ).toString('base64url');
  return payload + '.' + createHmac('sha256', key(credentials)).update(payload).digest('base64url');
}
function verify(credentials, token, executionId, nodeId, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096 || token.split('.').length !== 2)
    return false;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', key(credentials)).update(payload).digest();
  let decoded;
  try {
    const given = Buffer.from(signature, 'base64url');
    if (
      given.toString('base64url') !== signature ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    )
      return false;
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return false;
  }
  return (
    decoded.executionId === executionId &&
    decoded.nodeId === nodeId &&
    Number.isFinite(decoded.expires) &&
    decoded.expires > now
  );
}
function fields(value) {
  let f;
  try {
    f = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    fail('Custom form fields must be valid JSON.');
  }
  if (!Array.isArray(f) || !f.length || f.length > 20) fail('Supply 1–20 custom form fields.');
  const names = new Set();
  return f.map((v) => {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(v.name) ||
      ['token', '__proto__', 'constructor', 'prototype'].includes(v.name) ||
      names.has(v.name)
    )
      fail('Invalid or duplicate form field name.');
    names.add(v.name);
    if (!['text', 'textarea', 'number', 'select'].includes(v.type))
      fail('Unsupported custom form field type.');
    if (
      v.type === 'select' &&
      (!Array.isArray(v.options) ||
        !v.options.length ||
        v.options.length > 50 ||
        v.options.some((s) => typeof s !== 'string' || s.length > 200))
    )
      fail('Invalid select options.');
    return { ...v, label: String(v.label || v.name).slice(0, 200) };
  });
}
function render(type, token, formFields, title) {
  const hidden = `<input type="hidden" name="token" value="${x(token)}">`;
  let controls;
  if (type === 'approval')
    controls =
      '<button name="approved" value="true">Approve</button> <button name="approved" value="false">Decline</button>';
  else if (type === 'freeText')
    controls =
      '<label>Response<textarea name="response" maxlength="10000" required></textarea></label><button>Submit</button>';
  else if (type === 'customForm')
    controls =
      formFields
        .map(
          (f) =>
            `<p><label>${x(f.label)}${f.type === 'select' ? `<select name="${f.name}" ${f.required ? 'required' : ''}>${f.options.map((v) => `<option>${x(v)}</option>`).join('')}</select>` : f.type === 'textarea' ? `<textarea name="${f.name}" maxlength="10000" ${f.required ? 'required' : ''}></textarea>` : `<input name="${f.name}" type="${f.type}" maxlength="10000" ${f.required ? 'required' : ''}>`}</label></p>`,
        )
        .join('') + '<button>Submit</button>';
  else fail('Unknown response type.');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${x(title)}</title><body><h1>${x(title)}</h1><form method="post">${hidden}${controls}</form></body></html>`;
}
function answer(type, body, formFields) {
  if (type === 'approval') {
    if (!['true', 'false'].includes(body.approved)) fail('Invalid approval response.');
    return { approved: body.approved === 'true' };
  }
  if (type === 'freeText') {
    if (typeof body.response !== 'string' || !body.response.trim() || body.response.length > 10000)
      fail('Response must contain 1–10000 characters.');
    return { text: body.response };
  }
  if (type !== 'customForm') fail('Unknown response type.');
  const out = {};
  for (const f of formFields) {
    let v = body[f.name];
    if (v === undefined || v === '') {
      if (f.required) fail('A required field is missing.');
      continue;
    }
    if (typeof v !== 'string' || v.length > 10000) fail('Invalid field value.');
    if (f.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) fail('Invalid numeric value.');
    }
    if (f.type === 'select' && !f.options.includes(v)) fail('Invalid selection.');
    out[f.name] = v;
  }
  return out;
}
module.exports = { issue, verify, fields, render, answer };
