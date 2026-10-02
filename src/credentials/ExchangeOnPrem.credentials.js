'use strict';
const { versions } = require('../lib/config');
class ExchangeOnPrem {
  constructor() {
    this.name = 'exchangeOnPrem';
    this.displayName = 'Exchange On-Premises EWS';
    this.documentationUrl =
      'https://learn.microsoft.com/en-us/exchange/client-developer/exchange-web-services/start-using-web-services-in-exchange';
    this.properties = [
      {
        displayName: 'EWS Endpoint',
        name: 'endpoint',
        type: 'string',
        default: '',
        placeholder: 'https://mail.example.com/EWS/Exchange.asmx',
        required: true,
      },
      {
        displayName: 'Authentication',
        name: 'auth',
        type: 'options',
        options: [
          { name: 'NTLMv2', value: 'ntlm' },
          { name: 'Basic over HTTPS', value: 'basic' },
          { name: 'Bearer Token', value: 'bearer' },
        ],
        default: 'ntlm',
      },
      {
        displayName: 'Windows Domain',
        name: 'domain',
        type: 'string',
        default: '',
        displayOptions: { hide: { auth: ['bearer'] } },
      },
      {
        displayName: 'Username',
        name: 'username',
        type: 'string',
        default: '',
        displayOptions: { hide: { auth: ['bearer'] } },
      },
      {
        displayName: 'Password',
        name: 'password',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        displayOptions: { hide: { auth: ['bearer'] } },
      },
      {
        displayName: 'Access Token',
        name: 'accessToken',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        displayOptions: { show: { auth: ['bearer'] } },
        description:
          'Token must be issued for this EWS service. Automatic acquisition and refresh are not provided.',
      },
      {
        displayName: 'Mailbox',
        name: 'mailbox',
        type: 'string',
        default: '',
        placeholder: 'user@example.com',
        required: true,
      },
      {
        displayName: 'Response Signing Secret',
        name: 'responseSigningSecret',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description:
          'Separate random secret of at least 32 characters, required only for Send and Wait. Do not reuse the Exchange password.',
      },
      {
        displayName: 'EWS Schema Version',
        name: 'serverVersion',
        type: 'options',
        options: versions.map((value) => ({ name: value, value })),
        default: 'Exchange2013_SP1',
      },
      {
        displayName: 'Windows Time Zone ID',
        name: 'timeZone',
        type: 'string',
        default: 'UTC',
        description: 'For example UTC or W. Europe Standard Time',
      },
      ...[
        ['allowWrites', 'Allow Writes'],
        ['allowSend', 'Allow Sending and Invitations'],
        ['allowDelete', 'Allow Deletions'],
        ['allowAdmin', 'Allow Administrative Operations'],
        ['allowAdvanced', 'Allow Advanced EWS (Full Credential Authority)'],
        ['impersonate', 'Use EWS Impersonation'],
      ].map(([name, displayName]) => ({ displayName, name, type: 'boolean', default: false })),
      {
        displayName: 'TLS Channel Binding',
        name: 'channelBinding',
        type: 'options',
        options: [
          { name: 'Required', value: 'required' },
          { name: 'Disabled (Only If Server Policy Allows)', value: 'disabled' },
        ],
        default: 'required',
        displayOptions: { show: { auth: ['ntlm'] } },
      },
      {
        displayName: 'Service Principal Name',
        name: 'servicePrincipal',
        type: 'string',
        default: '',
        description: 'Optional override; defaults to HTTP/endpoint-hostname',
      },
      {
        displayName: 'Private CA Certificates (PEM)',
        name: 'caCertificate',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        description: 'Optional custom trust chain. HTTPS certificate validation is always enabled.',
      },
      {
        displayName: 'Timeout (Milliseconds)',
        name: 'timeoutMs',
        type: 'number',
        default: 60000,
        typeOptions: { minValue: 1000, maxValue: 1800000 },
      },
      {
        displayName: 'Maximum Response Size (MiB)',
        name: 'maxResponseMB',
        type: 'number',
        default: 32,
        typeOptions: { minValue: 1, maxValue: 128 },
      },
    ];
  }
}
module.exports = { ExchangeOnPrem };
