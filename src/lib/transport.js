'use strict';
const https = require('node:https');
const { ExchangeError } = require('./errors');
const { config } = require('./config');
const ntlm = require('./ntlm');
function post(url, agent, authorization, body, action, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false,
      timer;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    const req = https.request(
      url,
      {
        method: 'POST',
        agent,
        headers: {
          Authorization: authorization,
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          SOAPAction: `"${action}"`,
          Connection: 'keep-alive',
          'Accept-Encoding': 'identity',
          'User-Agent': 'n8n-exchange-onprem/0.2',
          'X-AnchorMailbox': options.mailbox,
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        const socket = res.socket,
          certificate = socket.getPeerCertificate()?.raw;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            done(new ExchangeError('SIZE', 'Exchange response exceeds the configured limit.'));
            req.destroy();
          } else chunks.push(chunk);
        });
        res.on('end', () =>
          done(null, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            socket,
            certificate,
          }),
        );
        res.on('aborted', () =>
          done(
            new ExchangeError(
              'NETWORK',
              'Exchange closed the response. Check the outcome before repeating writes.',
            ),
          ),
        );
        res.on('error', () => done(new ExchangeError('NETWORK', 'Exchange response failed.')));
      },
    );
    timer = setTimeout(() => {
      done(
        new ExchangeError(
          'TIMEOUT',
          'Exchange response timed out. Check the outcome before repeating writes.',
        ),
      );
      req.destroy();
    }, options.timeoutMs);
    req.on('socket', (s) => {
      if (options.expectedSocket && s !== options.expectedSocket) {
        done(
          new ExchangeError('NTLM_CONNECTION', 'NTLM requires one uninterrupted TLS connection.'),
        );
        req.destroy();
      }
    });
    req.on('error', (error) =>
      done(
        new ExchangeError(
          'NETWORK',
          /CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code || '')
            ? 'TLS certificate validation failed. Configure the issuing CA; certificate checking cannot be disabled.'
            : 'Exchange connection failed. Check the outcome before repeating writes.',
        ),
      ),
    );
    req.end(body);
  });
}
async function send(credentials, request, dependencies = {}) {
  const c = config(credentials),
    agent = new https.Agent({
      keepAlive: true,
      maxSockets: 1,
      maxFreeSockets: 1,
      ...(c.caCertificate ? { ca: c.caCertificate } : {}),
    });
  const poster = dependencies.post || post,
    options = {
      timeoutMs: request.streaming ? Math.max(c.timeoutMs, 120000) : c.timeoutMs,
      maxBytes: c.maxResponseMB * 1024 * 1024,
      mailbox: c.mailbox,
    };
  try {
    let authorization;
    if (c.auth === 'ntlm') {
      const type1 = ntlm.negotiate();
      const r = await poster(
        c.endpoint,
        agent,
        'NTLM ' + type1.toString('base64'),
        '',
        request.soapAction,
        options,
      );
      if (r.status >= 300 && r.status < 400)
        throw new ExchangeError(
          'REDIRECT',
          'Use the final EWS endpoint; redirects are not followed.',
        );
      const token = String(r.headers['www-authenticate'] || '').match(
        /(?:^|,\s*)NTLM\s+([A-Za-z0-9+/=]+)/i,
      )?.[1];
      if (r.status !== 401 || !token)
        throw new ExchangeError('NTLM', 'The endpoint did not return an NTLM challenge.');
      const type3 = ntlm.authenticate(type1, Buffer.from(token, 'base64'), c, r.certificate);
      authorization = 'NTLM ' + type3.toString('base64');
      options.expectedSocket = r.socket;
    } else if (c.auth === 'basic')
      authorization =
        'Basic ' +
        Buffer.from(`${c.domain ? c.domain + '\\' : ''}${c.username}:${c.password}`).toString(
          'base64',
        );
    else authorization = 'Bearer ' + c.accessToken;
    const r = await poster(
      c.endpoint,
      agent,
      authorization,
      request.xml,
      request.soapAction,
      options,
    );
    if (r.status === 401 || r.status === 403)
      throw new ExchangeError(
        'AUTH',
        `Exchange rejected authentication or access (HTTP ${r.status}). Check credentials, EWS permissions and server policy.`,
      );
    if (r.status >= 300 && r.status < 400)
      throw new ExchangeError('REDIRECT', 'Authenticated redirects are not followed.');
    if (r.status !== 200 && r.status !== 500)
      throw new ExchangeError(
        'HTTP',
        `Exchange returned HTTP ${r.status}. Check the outcome before repeating writes.`,
        { status: r.status, retryAfter: r.headers['retry-after'] || null },
      );
    return r.body;
  } finally {
    agent.destroy();
  }
}
module.exports = { post, send };
