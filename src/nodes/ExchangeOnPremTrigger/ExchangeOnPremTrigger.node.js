'use strict';
const { poll } = require('../../lib/poll');
const { nodeError } = require('../../lib/errors');
class ExchangeOnPremTrigger {
  constructor() {
    this.description = {
      displayName: 'Exchange On-Premises Trigger',
      name: 'exchangeOnPremTrigger',
      icon: 'file:../ExchangeOnPrem/exchange.svg',
      group: ['trigger'],
      version: 1,
      description: 'Poll Exchange item changes using EWS synchronization state',
      defaults: { name: 'Exchange On-Premises Trigger' },
      inputs: [],
      outputs: ['main'],
      polling: true,
      credentials: [{ name: 'exchangeOnPrem', required: true }],
      properties: [
        {
          displayName: 'Folder',
          name: 'folder',
          type: 'options',
          options: ['inbox', 'calendar', 'contacts', 'tasks', 'sentitems', 'drafts'].map((v) => ({
            name: v,
            value: v,
          })),
          default: 'inbox',
        },
        {
          displayName: 'Folder ID',
          name: 'folderId',
          type: 'string',
          default: '',
          description: 'Optional custom folder ID; overrides Folder',
        },
        {
          displayName: 'Change Type',
          name: 'changeType',
          type: 'options',
          options: ['all', 'Create', 'Update', 'Delete', 'ReadFlagChange'].map((v) => ({
            name: v,
            value: v,
          })),
          default: 'Create',
        },
        {
          displayName: 'Emit Existing Items on First Poll',
          name: 'emitExisting',
          type: 'boolean',
          default: false,
        },
        {
          displayName: 'Maximum Pages per Poll',
          name: 'maxPages',
          type: 'number',
          default: 20,
          typeOptions: { minValue: 1, maxValue: 100 },
        },
        {
          displayName:
            'Sync changes contain IDs and change keys. Connect the Exchange node to fetch complete items and attachments. Delivery is at least once; make downstream writes idempotent.',
          name: 'notice',
          type: 'notice',
          default: '',
        },
      ],
    };
  }
  async poll() {
    try {
      const c = await this.getCredentials('exchangeOnPrem');
      const state = this.getWorkflowStaticData('node');
      const params = Object.fromEntries(
        ['folder', 'folderId', 'changeType', 'emitExisting', 'maxPages'].map((k) => [
          k,
          this.getNodeParameter(k),
        ]),
      );
      const manual = this.getMode() === 'manual';
      if (manual) params.emitExisting = true;
      const r = await poll(c, params, manual ? {} : state);
      if (this.getMode() !== 'manual') Object.assign(state, r.state);
      return r.changes.length ? [r.changes.map((json) => ({ json }))] : null;
    } catch (e) {
      throw nodeError(this.getNode(), e);
    }
  }
}
module.exports = { ExchangeOnPremTrigger };
