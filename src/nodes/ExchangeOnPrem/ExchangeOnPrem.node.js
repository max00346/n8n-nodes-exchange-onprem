'use strict';
const { registry } = require('../../lib/requests');
const { execute, parameters } = require('../../lib/client');
const { safeError, nodeError } = require('../../lib/errors');
const { output } = require('../../lib/node-helpers');
const resources = [...new Set(Object.values(registry).map((v) => v.resource))].sort();
const label = (v) => v.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
class ExchangeOnPrem {
  constructor() {
    this.description = {
      displayName: 'Exchange On-Premises',
      name: 'exchangeOnPrem',
      icon: 'file:exchange.svg',
      group: ['transform'],
      version: 1,
      description: 'Use on-premises Exchange EWS with NTLMv2, Basic or bearer authentication',
      defaults: { name: 'Exchange On-Premises' },
      inputs: ['main'],
      outputs: ['main'],
      usableAsTool: true,
      credentials: [{ name: 'exchangeOnPrem', required: true, testedBy: 'testExchange' }],
      properties: [
        {
          displayName: 'Resource',
          name: 'resource',
          type: 'options',
          options: resources.map((v) => ({ name: label(v), value: v })),
          default: 'message',
          noDataExpression: true,
        },
        ...resources.map((resource) => ({
          displayName: 'Operation',
          name: 'operation',
          type: 'options',
          displayOptions: { show: { resource: [resource] } },
          options: Object.values(registry)
            .filter((v) => v.resource === resource)
            .map((v) => ({
              name: label(v.operation),
              value: v.operation,
              action: label(v.operation) + ' ' + label(resource),
            })),
          default: Object.values(registry).find((v) => v.resource === resource).operation,
        })),
        {
          displayName: 'Parameters (JSON)',
          name: 'parameters',
          type: 'json',
          default: '{}',
          description:
            'Operation fields, e.g. {"itemId":"…"}. See the operation reference. Fields support n8n expressions.',
        },
        {
          displayName: 'Confirm Requested Change',
          name: 'confirm',
          type: 'boolean',
          default: false,
          description:
            'Whether this run was explicitly requested to perform changes. Credential permissions also apply.',
        },
        {
          displayName: 'Advanced EWS XML',
          name: 'advancedNotice',
          type: 'notice',
          default:
            'Advanced EWS runs with the full authority of this credential. Enable it only for trusted workflows; never expose it as an unrestricted AI tool.',
          displayOptions: { show: { resource: ['advanced'] } },
        },
      ],
    };
    this.methods = {
      credentialTest: {
        async testExchange(credential) {
          try {
            await execute(credential.data, 'connection.test');
            return { status: 'OK', message: 'Authentication and EWS mailbox read succeeded.' };
          } catch (e) {
            return { status: 'Error', message: safeError(e) };
          }
        },
      },
    };
  }
  async execute() {
    const data = this.getInputData(),
      out = [];
    for (let i = 0; i < data.length; i++) {
      try {
        const credentials = await this.getCredentials('exchangeOnPrem', i);
        const resource = this.getNodeParameter('resource', i),
          operation = this.getNodeParameter('operation', i),
          action = resource + '.' + operation;
        const p = { ...parameters(this.getNodeParameter('parameters', i, '{}')) };
        p.confirm = this.getNodeParameter('confirm', i, false) === true;
        if (action === 'attachment.add' && !p.contentBase64) {
          const prop = p.binaryProperty || 'data';
          const b = await this.helpers.getBinaryDataBuffer(i, prop);
          if (b.length > 25 * 1024 * 1024) throw new Error('Attachment too large');
          p.contentBase64 = b.toString('base64');
          p.fileName = p.fileName || data[i].binary?.[prop]?.fileName || 'attachment';
          p.contentType = p.contentType || data[i].binary?.[prop]?.mimeType;
        }
        const result = await execute(credentials, action, p);
        out.push(...(await output(this, result, action, i, p)));
      } catch (e) {
        if (this.continueOnFail())
          out.push({ json: { error: safeError(e) }, pairedItem: { item: i } });
        else throw nodeError(this.getNode(), e, i);
      }
    }
    return [out];
  }
}
module.exports = { ExchangeOnPrem };
