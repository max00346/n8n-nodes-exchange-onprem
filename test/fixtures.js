'use strict';
const credentials = {
  endpoint: 'https://mail.example.test/EWS/Exchange.asmx',
  auth: 'ntlm',
  domain: 'Domain',
  username: 'User',
  password: 'Password',
  mailbox: 'user@example.test',
  timeZone: 'UTC',
  allowWrites: true,
  allowSend: true,
  allowDelete: true,
  allowAdmin: true,
  allowAdvanced: true,
  responseSigningSecret: 'synthetic-response-signing-secret-0123456789',
};
const parameters = {
  itemId: 'item-id',
  changeKey: 'change-key',
  folderId: 'folder-id',
  destinationFolderId: 'destination-id',
  attachmentId: 'attachment-id',
  subject: 'Subject & <text>',
  body: 'Full body: Grüße',
  to: ['recipient@example.test'],
  email: 'room@example.test',
  emails: ['person@example.test'],
  displayName: 'New name',
  fileName: 'report.txt',
  contentType: 'text/plain',
  contentBase64: Buffer.from('Grüße').toString('base64'),
  start: '2026-10-02T08:00:00Z',
  end: '2026-10-02T09:00:00Z',
  due: '2026-10-03T08:00:00Z',
  state: 'Enabled',
  status: 'Completed',
  subscriptionId: 'sub-id',
  watermark: 'watermark',
  query: 'subject:test',
  response: 'AcceptItem',
  confirm: true,
  ewsOperation: 'GetItem',
  bodyXml:
    '<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:ItemIds><t:ItemId Id="id"/></m:ItemIds></m:GetItem>',
};
const envelope = (inner) =>
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><s:Body><m:GetItemResponse><m:ResponseMessages><m:GetItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>${inner}</m:GetItemResponseMessage></m:ResponseMessages></m:GetItemResponse></s:Body></s:Envelope>`;
const draft = (isDraft = true, key = 'change-key') =>
  envelope(
    `<m:Items><t:Message><t:ItemId Id="item-id" ChangeKey="${key}"/><t:IsDraft>${isDraft}</t:IsDraft><t:Body BodyType="Text">Grüße &amp; Text</t:Body></t:Message></m:Items>`,
  );
module.exports = { credentials, parameters, envelope, draft };
