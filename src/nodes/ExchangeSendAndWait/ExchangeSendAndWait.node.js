'use strict';
const { execute } = require('../../lib/client');
const { safeError, ExchangeError, nodeError } = require('../../lib/errors');
const approval = require('../../lib/approval');
const { x } = require('../../lib/xml');
class ExchangeSendAndWait {
  constructor() {
    this.description = {
      displayName: 'Exchange Send and Wait',
      name: 'exchangeSendAndWait',
      icon: 'file:../ExchangeOnPrem/exchange.svg',
      group: ['transform'],
      version: 1,
      description:
        'Send an Exchange email and wait for a signed approval, text response or custom form',
      defaults: { name: 'Exchange Send and Wait' },
      inputs: ['main'],
      outputs: ['main'],
      credentials: [{ name: 'exchangeOnPrem', required: true }],
      webhooks: [
        {
          name: 'default',
          httpMethod: 'GET',
          responseMode: 'onReceived',
          path: '={{ $nodeId }}',
          restartWebhook: true,
          isFullPath: true,
        },
        {
          name: 'default',
          httpMethod: 'POST',
          responseMode: 'onReceived',
          path: '={{ $nodeId }}',
          restartWebhook: true,
          isFullPath: true,
        },
      ],
      properties: [
        {
          displayName: 'Recipients',
          name: 'to',
          type: 'string',
          default: '',
          required: true,
          description: 'Comma-separated SMTP addresses',
        },
        {
          displayName: 'Subject',
          name: 'subject',
          type: 'string',
          default: 'Response requested',
          required: true,
        },
        {
          displayName: 'Message',
          name: 'message',
          type: 'string',
          typeOptions: { rows: 5 },
          default: '',
          required: true,
        },
        {
          displayName: 'Response Type',
          name: 'responseType',
          type: 'options',
          options: [
            { name: 'Approval', value: 'approval' },
            { name: 'Free Text', value: 'freeText' },
            { name: 'Custom Form', value: 'customForm' },
          ],
          default: 'approval',
        },
        {
          displayName: 'Form Fields (JSON)',
          name: 'formFields',
          type: 'json',
          default: '[{"name":"response","label":"Response","type":"text","required":true}]',
          displayOptions: { show: { responseType: ['customForm'] } },
        },
        {
          displayName: 'Wait Limit (Hours)',
          name: 'waitHours',
          type: 'number',
          default: 24,
          typeOptions: { minValue: 0.01, maxValue: 720 },
        },
        { displayName: 'Confirm Send', name: 'confirm', type: 'boolean', default: false },
        {
          displayName:
            'This node sends one email per execution and requires exactly one input item. Links grant response access to anyone holding them; GET only displays the form and POST records the answer.',
          name: 'notice',
          type: 'notice',
          default: '',
        },
      ],
    };
  }
  async execute() {
    try {
      const items = this.getInputData();
      if (items.length !== 1)
        throw new ExchangeError('INPUT', 'Send and Wait requires exactly one input item.');
      const c = await this.getCredentials('exchangeOnPrem');
      const hours = Number(this.getNodeParameter('waitHours', 0, 24));
      if (!Number.isFinite(hours) || hours < 0.01 || hours > 720)
        throw new ExchangeError('INPUT', 'Wait limit must be between 0.01 and 720 hours.');
      const responseType = this.getNodeParameter('responseType', 0);
      if (responseType === 'customForm') approval.fields(this.getNodeParameter('formFields', 0));
      const expires = Date.now() + hours * 3600000,
        token = approval.issue(c, this.getExecutionId(), this.getNode().id, expires);
      let url;
      if (
        typeof this.getSignedResumeUrl === 'function' &&
        typeof this.setSignatureValidationRequired === 'function'
      ) {
        this.setSignatureValidationRequired();
        url = new URL(this.getSignedResumeUrl({ token }));
      } else {
        url = new URL(String(this.evaluateExpression('{{ $execution.resumeUrl }}', 0)));
        url.pathname =
          url.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(this.getNode().id);
        url.searchParams.set('token', token);
      }
      if (url.protocol !== 'https:')
        throw new ExchangeError(
          'CONFIG',
          'Configure a public HTTPS n8n webhook URL before sending response links.',
        );
      const to = String(this.getNodeParameter('to', 0))
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        subject = this.getNodeParameter('subject', 0),
        message = this.getNodeParameter('message', 0);
      await execute(c, 'message.send', {
        to,
        subject,
        body: `<p>${x(message).replace(/\n/g, '<br>')}</p><p><a href="${x(url.toString())}">Open response form</a></p>`,
        bodyType: 'HTML',
        confirm: this.getNodeParameter('confirm', 0, false),
      });
      await this.putExecutionToWait(new Date(expires));
      return [
        [
          {
            json: {
              ...items[0].json,
              response: { status: 'timedOut', expiresAt: new Date(expires).toISOString() },
            },
            pairedItem: { item: 0 },
          },
        ],
      ];
    } catch (e) {
      throw nodeError(this.getNode(), e);
    }
  }
  async webhook() {
    const res = this.getResponseObject(),
      req = this.getRequestObject();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    try {
      const c = await this.getCredentials('exchangeOnPrem'),
        body = this.getBodyData(),
        query = this.getQueryData();
      const token = req.method === 'POST' ? body.token : query.token;
      if (!approval.verify(c, token, this.getExecutionId(), this.getNode().id)) {
        res.status(403).send('Invalid or expired response link.');
        return { noWebhookResponse: true };
      }
      const type = this.getNodeParameter('responseType', 'approval'),
        formFields =
          type === 'customForm' ? approval.fields(this.getNodeParameter('formFields', '[]')) : [];
      if (req.method === 'GET') {
        res
          .type('html')
          .send(
            approval.render(
              type,
              token,
              formFields,
              this.getNodeParameter('subject', 'Response requested'),
            ),
          );
        return { noWebhookResponse: true };
      }
      if (req.method !== 'POST') {
        res.status(405).send('Method not allowed.');
        return { noWebhookResponse: true };
      }
      const data = approval.answer(type, body, formFields);
      res
        .type('html')
        .send(
          '<!doctype html><title>Response recorded</title><p>Your response has been recorded.</p>',
        );
      return {
        noWebhookResponse: true,
        workflowData: [
          [
            {
              json: {
                response: { status: 'received', ...data, receivedAt: new Date().toISOString() },
                contentIsUntrusted: true,
              },
            },
          ],
        ],
      };
    } catch (e) {
      res.status(400).send(safeError(e));
      return { noWebhookResponse: true };
    }
  }
}
module.exports = { ExchangeSendAndWait };
