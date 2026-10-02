'use strict';
const { x, tag, envelope, parse, NS } = require('./xml');
const { fail } = require('./errors');
const ewsOperations = require('./ews-operations.json');
const registry = {};
const add = (resource, operation, soap, effects, build) => {
  registry[`${resource}.${operation}`] = { resource, operation, soap, effects, build };
};
const str = (p, key, max = 200000, optional = false) => {
  if (optional && p[key] === undefined) return '';
  if (typeof p[key] !== 'string' || (!optional && !p[key].trim()) || p[key].length > max)
    fail(`Invalid ${key}.`);
  return p[key];
};
const number = (v, def, min, max) => {
  v = v ?? def;
  if (!Number.isInteger(v) || v < min || v > max) fail('Number outside the allowed range.');
  return v;
};
const choice = (value, values, def) => {
  value = value ?? def;
  if (!values.includes(value)) fail(`Expected one of: ${values.join(', ')}.`);
  return value;
};
const bool = (value, def = false) => {
  if (value === undefined) return def;
  if (typeof value !== 'boolean') fail('Boolean value required.');
  return value;
};
const email = (value) => {
  if (
    typeof value !== 'string' ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) ||
    value.length > 320
  )
    fail('Invalid SMTP address.');
  return value;
};
const date = (value) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail('ISO date/time including timezone required.');
  return value;
};
const list = (value, max = 100) => {
  if (!Array.isArray(value) || value.length > max)
    fail(`Array with at most ${max} entries required.`);
  return value;
};
const itemId = (p, change = false) =>
  `<t:ItemId Id="${x(str(p, 'itemId', 4096))}"${change ? ` ChangeKey="${x(str(p, 'changeKey', 4096))}"` : ''}/>`;
const folderNames = [
  'inbox',
  'sentitems',
  'drafts',
  'deleteditems',
  'msgfolderroot',
  'calendar',
  'contacts',
  'tasks',
  'root',
  'junkemail',
  'outbox',
  'publicfoldersroot',
  'archiveinbox',
  'archivemsgfolderroot',
  'archivedeleteditems',
  'recoverableitemsroot',
  'recoverableitemsdeletions',
  'recoverableitemsversions',
  'recoverableitemspurges',
  'archiverecoverableitemsroot',
];
function folder(p, c, fallback = 'inbox', key = 'folderId') {
  return p[key]
    ? `<t:FolderId Id="${x(str(p, key, 4096))}"/>`
    : `<t:DistinguishedFolderId Id="${choice(p.folder, folderNames, fallback)}"><t:Mailbox>${tag('t:EmailAddress', c.mailbox)}</t:Mailbox></t:DistinguishedFolderId>`;
}
const field = (name) => `<t:FieldURI FieldURI="${name}"/>`;
const fields = (names) =>
  names.length
    ? `<t:AdditionalProperties>${names.map(field).join('')}</t:AdditionalProperties>`
    : '';
const shape = (p, base = 'AllProperties', props = []) =>
  `<m:ItemShape><t:BaseShape>${base}</t:BaseShape>${p.mime ? '<t:IncludeMimeContent>true</t:IncludeMimeContent>' : ''}<t:BodyType>${choice(p.bodyType, ['Text', 'HTML', 'Best'], 'Text')}</t:BodyType>${fields(props)}</m:ItemShape>`;
const recipients = (values, attendee = false) =>
  list(values, 100)
    .map((v) =>
      attendee
        ? `<t:Attendee><t:Mailbox>${tag('t:EmailAddress', email(v))}</t:Mailbox></t:Attendee>`
        : `<t:Mailbox>${tag('t:EmailAddress', email(v))}</t:Mailbox>`,
    )
    .join('');
const body = (p) =>
  p.body === undefined
    ? ''
    : `<t:Body BodyType="${choice(p.bodyType, ['Text', 'HTML'], 'Text')}">${x(str(p, 'body'))}</t:Body>`;
function common(p) {
  return (
    (p.subject === undefined ? '' : tag('t:Subject', str(p, 'subject', 998))) +
    (p.sensitivity === undefined
      ? ''
      : tag(
          't:Sensitivity',
          choice(p.sensitivity, ['Normal', 'Personal', 'Private', 'Confidential']),
        )) +
    body(p) +
    (p.categories
      ? `<t:Categories>${list(p.categories)
          .map((v) => tag('t:String', v))
          .join('')}</t:Categories>`
      : '') +
    (p.importance ? tag('t:Importance', choice(p.importance, ['Low', 'Normal', 'High'])) : '')
  );
}
function message(p) {
  return `<t:Message>${common(p)}${['to', 'cc', 'bcc'].map((k, i) => (p[k] ? `<t:${['To', 'Cc', 'Bcc'][i]}Recipients>${recipients(p[k])}</t:${['To', 'Cc', 'Bcc'][i]}Recipients>` : '')).join('')}${p.readReceipt ? '<t:IsReadReceiptRequested>true</t:IsReadReceiptRequested>' : ''}${p.deliveryReceipt ? '<t:IsDeliveryReceiptRequested>true</t:IsDeliveryReceiptRequested>' : ''}${p.isRead === undefined ? '' : tag('t:IsRead', bool(p.isRead))}</t:Message>`;
}
function recurrence(p) {
  if (!p.recurrence) return '';
  const r = p.recurrence;
  const interval = number(r.interval, 1, 1, 999);
  let pattern;
  switch (r.pattern) {
    case 'daily':
      pattern = `<t:DailyRecurrence>${tag('t:Interval', interval)}</t:DailyRecurrence>`;
      break;
    case 'weekly':
      pattern = `<t:WeeklyRecurrence>${tag('t:Interval', interval)}${tag(
        't:DaysOfWeek',
        list(r.days, 7)
          .map((d) =>
            choice(d, [
              'Sunday',
              'Monday',
              'Tuesday',
              'Wednesday',
              'Thursday',
              'Friday',
              'Saturday',
              'Day',
              'Weekday',
              'WeekendDay',
            ]),
          )
          .join(' '),
      )}</t:WeeklyRecurrence>`;
      break;
    case 'monthly':
      pattern = `<t:AbsoluteMonthlyRecurrence>${tag('t:Interval', interval)}${tag('t:DayOfMonth', number(r.day, 1, 1, 31))}</t:AbsoluteMonthlyRecurrence>`;
      break;
    case 'yearly':
      pattern = `<t:AbsoluteYearlyRecurrence>${tag('t:DayOfMonth', number(r.day, 1, 1, 31))}${tag('t:Month', choice(r.month, ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']))}</t:AbsoluteYearlyRecurrence>`;
      break;
    default:
      fail('Unsupported recurrence pattern.');
  }
  const start = str(r, 'startDate', 10);
  if (!/^\d{4}-\d\d-\d\d$/.test(start) || !Number.isFinite(Date.parse(start)))
    fail('Invalid recurrence start date.');
  let range;
  if (r.count !== undefined)
    range = `<t:NumberedRecurrence>${tag('t:StartDate', start)}${tag('t:NumberOfOccurrences', number(r.count, 1, 1, 999))}</t:NumberedRecurrence>`;
  else if (r.endDate) {
    if (!/^\d{4}-\d\d-\d\d$/.test(r.endDate) || Date.parse(r.endDate) < Date.parse(start))
      fail('Invalid recurrence end date.');
    range = `<t:EndDateRecurrence>${tag('t:StartDate', start)}${tag('t:EndDate', r.endDate)}</t:EndDateRecurrence>`;
  } else range = `<t:NoEndRecurrence>${tag('t:StartDate', start)}</t:NoEndRecurrence>`;
  return `<t:Recurrence>${pattern}${range}</t:Recurrence>`;
}
function calendarItem(p) {
  date(p.start);
  date(p.end);
  if (Date.parse(p.end) <= Date.parse(p.start)) fail('Event end must be after start.');
  return `<t:CalendarItem>${common(p)}${tag('t:Start', p.start)}${tag('t:End', p.end)}${tag('t:IsAllDayEvent', bool(p.isAllDay))}${tag('t:LegacyFreeBusyStatus', choice(p.showAs, ['Free', 'Tentative', 'Busy', 'OOF', 'WorkingElsewhere', 'NoData'], 'Busy'))}${p.location === undefined ? '' : tag('t:Location', p.location)}${['requiredAttendees', 'optionalAttendees', 'resources'].map((k, i) => (p[k] ? `<t:${['RequiredAttendees', 'OptionalAttendees', 'Resources'][i]}>${recipients(p[k], true)}</t:${['RequiredAttendees', 'OptionalAttendees', 'Resources'][i]}>` : '')).join('')}${recurrence(p)}${p.startTimeZone ? `<t:StartTimeZone Id="${x(p.startTimeZone)}"/>` : ''}${p.endTimeZone ? `<t:EndTimeZone Id="${x(p.endTimeZone)}"/>` : ''}</t:CalendarItem>`;
}
function contact(p) {
  return `<t:Contact>${common(p)}${['fileAs', 'displayName', 'givenName', 'middleName', 'nickname', 'companyName'].map((k, i) => (p[k] === undefined ? '' : tag('t:' + ['FileAs', 'DisplayName', 'GivenName', 'MiddleName', 'Nickname', 'CompanyName'][i], p[k]))).join('')}${
    p.emailAddresses
      ? `<t:EmailAddresses>${list(p.emailAddresses, 3)
          .map((v, i) => `<t:Entry Key="EmailAddress${i + 1}">${x(email(v))}</t:Entry>`)
          .join('')}</t:EmailAddresses>`
      : ''
  }${
    p.phoneNumbers
      ? `<t:PhoneNumbers>${Object.entries(p.phoneNumbers)
          .map(
            ([k, v]) =>
              `<t:Entry Key="${choice(k, ['AssistantPhone', 'BusinessFax', 'BusinessPhone', 'BusinessPhone2', 'Callback', 'CarPhone', 'CompanyMainPhone', 'HomeFax', 'HomePhone', 'HomePhone2', 'Isdn', 'MobilePhone', 'OtherFax', 'OtherTelephone', 'Pager', 'PrimaryPhone', 'RadioPhone', 'Telex', 'TtyTddPhone'])}">${x(v)}</t:Entry>`,
          )
          .join('')}</t:PhoneNumbers>`
      : ''
  }${['department', 'jobTitle', 'officeLocation', 'surname'].map((k, i) => (p[k] === undefined ? '' : tag('t:' + ['Department', 'JobTitle', 'OfficeLocation', 'Surname'][i], p[k]))).join('')}</t:Contact>`;
}
function task(p) {
  return `<t:Task>${common(p)}${p.due ? tag('t:DueDate', date(p.due)) : ''}${p.percentComplete === undefined ? '' : tag('t:PercentComplete', number(p.percentComplete, 0, 0, 100))}${p.start ? tag('t:StartDate', date(p.start)) : ''}${tag('t:Status', choice(p.status, ['NotStarted', 'InProgress', 'Completed', 'WaitingOnOthers', 'Deferred'], 'NotStarted'))}</t:Task>`;
}
function createItem(kind, p, c, disposition = 'SaveOnly') {
  if (['Message', 'CalendarItem', 'Task'].includes(kind)) str(p, 'subject', 998);
  const render = { Message: message, CalendarItem: calendarItem, Contact: contact, Task: task }[
    kind
  ];
  const attrs =
    kind === 'Message'
      ? ` MessageDisposition="${disposition}"`
      : kind === 'CalendarItem'
        ? ` SendMeetingInvitations="${choice(p.invitations, ['SendToNone', 'SendOnlyToAll', 'SendToAllAndSaveCopy'], 'SendToNone')}"`
        : '';
  return `<m:CreateItem${attrs}><m:SavedItemFolderId>${folder(p, c, { Message: disposition === 'SaveOnly' ? 'drafts' : 'sentitems', CalendarItem: 'calendar', Contact: 'contacts', Task: 'tasks' }[kind])}</m:SavedItemFolderId><m:Items>${render(p)}</m:Items></m:CreateItem>`;
}
const updateMap = {
  subject: ['item:Subject', 'Subject'],
  body: ['item:Body', 'Body'],
  sensitivity: ['item:Sensitivity', 'Sensitivity'],
  importance: ['item:Importance', 'Importance'],
  categories: ['item:Categories', 'Categories'],
  isRead: ['message:IsRead', 'IsRead'],
  to: ['message:ToRecipients', 'ToRecipients'],
  cc: ['message:CcRecipients', 'CcRecipients'],
  bcc: ['message:BccRecipients', 'BccRecipients'],
  start: ['calendar:Start', 'Start'],
  end: ['calendar:End', 'End'],
  location: ['calendar:Location', 'Location'],
  isAllDay: ['calendar:IsAllDayEvent', 'IsAllDayEvent'],
  showAs: ['calendar:LegacyFreeBusyStatus', 'LegacyFreeBusyStatus'],
  requiredAttendees: ['calendar:RequiredAttendees', 'RequiredAttendees'],
  optionalAttendees: ['calendar:OptionalAttendees', 'OptionalAttendees'],
  resources: ['calendar:Resources', 'Resources'],
  givenName: ['contacts:GivenName', 'GivenName'],
  surname: ['contacts:Surname', 'Surname'],
  displayName: ['contacts:DisplayName', 'DisplayName'],
  companyName: ['contacts:CompanyName', 'CompanyName'],
  jobTitle: ['contacts:JobTitle', 'JobTitle'],
  department: ['contacts:Department', 'Department'],
  status: ['task:Status', 'Status'],
  due: ['task:DueDate', 'DueDate'],
  percentComplete: ['task:PercentComplete', 'PercentComplete'],
};
function updateItem(kind, p) {
  const updates = [];
  for (const [k, [uri, name]] of Object.entries(updateMap)) {
    if (p[k] === undefined) continue;
    if (
      !uri.startsWith('item:') &&
      !uri.startsWith(
        { Message: 'message:', CalendarItem: 'calendar:', Contact: 'contacts:', Task: 'task:' }[
          kind
        ],
      )
    )
      continue;
    let value;
    if (k === 'body') value = body(p);
    else if (['to', 'cc', 'bcc'].includes(k)) value = `<t:${name}>${recipients(p[k])}</t:${name}>`;
    else if (['requiredAttendees', 'optionalAttendees', 'resources'].includes(k))
      value = `<t:${name}>${recipients(p[k], true)}</t:${name}>`;
    else if (k === 'categories')
      value = `<t:Categories>${list(p[k])
        .map((v) => tag('t:String', v))
        .join('')}</t:Categories>`;
    else if (['start', 'end', 'due'].includes(k)) value = tag('t:' + name, date(p[k]));
    else if (['isRead', 'isAllDay'].includes(k)) value = tag('t:' + name, bool(p[k]));
    else if (k === 'percentComplete') value = tag('t:' + name, number(p[k], 0, 0, 100));
    else if (k === 'status')
      value = tag(
        't:' + name,
        choice(p[k], ['NotStarted', 'InProgress', 'Completed', 'WaitingOnOthers', 'Deferred']),
      );
    else value = tag('t:' + name, p[k]);
    updates.push(`<t:SetItemField>${field(uri)}<t:${kind}>${value}</t:${kind}></t:SetItemField>`);
  }
  if (!updates.length)
    fail('No supported update fields supplied. Use Advanced EWS for extended/indexed properties.');
  return `<m:UpdateItem ConflictResolution="NeverOverwrite"${kind === 'Message' ? ' MessageDisposition="SaveOnly"' : ''}${kind === 'CalendarItem' ? ` SendMeetingInvitationsOrCancellations="${choice(p.invitations, ['SendToNone', 'SendOnlyToAll', 'SendToAllAndSaveCopy'], 'SendToNone')}"` : ''}><m:ItemChanges><t:ItemChange>${itemId(p, true)}<t:Updates>${updates.join('')}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>`;
}
function findItems(p, c, fallback) {
  const props =
    fallback === 'contacts'
      ? ['contacts:DisplayName', 'contacts:EmailAddresses', 'contacts:PhoneNumbers']
      : fallback === 'tasks'
        ? ['item:Subject', 'task:Status', 'task:DueDate', 'task:PercentComplete']
        : [
            'item:Subject',
            'item:DateTimeReceived',
            'item:HasAttachments',
            'message:From',
            'message:IsRead',
          ];
  return `<m:FindItem Traversal="Shallow">${shape(p, 'IdOnly', props)}<m:IndexedPageItemView MaxEntriesReturned="${number(p.limit, 100, 1, 1000)}" Offset="${number(p.offset, 0, 0, 1000000)}" BasePoint="Beginning"/><m:ParentFolderIds>${folder(p, c, fallback)}</m:ParentFolderIds>${p.query ? tag('m:QueryString', str(p, 'query', 4096)) : ''}</m:FindItem>`;
}
function getItem(p) {
  return `<m:GetItem>${shape(p)}<m:ItemIds>${itemId(p)}</m:ItemIds></m:GetItem>`;
}
function deleteItem(p) {
  return `<m:DeleteItem DeleteType="${choice(p.deleteType, ['MoveToDeletedItems', 'SoftDelete', 'HardDelete'], 'MoveToDeletedItems')}" SendMeetingCancellations="${choice(p.cancellations, ['SendToNone', 'SendOnlyToAll', 'SendToAllAndSaveCopy'], 'SendToNone')}" AffectedTaskOccurrences="${choice(p.taskOccurrences, ['AllOccurrences', 'SpecifiedOccurrenceOnly'], 'AllOccurrences')}"><m:ItemIds>${itemId(p)}</m:ItemIds></m:DeleteItem>`;
}
for (const [r, kind, defaultFolder] of [
  ['message', 'Message', 'inbox'],
  ['draft', 'Message', 'drafts'],
  ['event', 'CalendarItem', 'calendar'],
  ['contact', 'Contact', 'contacts'],
  ['task', 'Task', 'tasks'],
]) {
  add(r, 'get', 'GetItem', [], getItem);
  add(r, 'getAll', 'FindItem', [], (p, c) => findItems(p, c, defaultFolder));
  add(r, 'update', 'UpdateItem', ['write'], (p) => updateItem(kind, p));
  add(r, 'delete', 'DeleteItem', ['delete'], deleteItem);
  if (r !== 'message') add(r, 'create', 'CreateItem', ['write'], (p, c) => createItem(kind, p, c));
}
add(
  'connection',
  'test',
  'GetFolder',
  [],
  (p, c) =>
    `<m:GetFolder><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape><m:FolderIds>${folder({}, c, 'msgfolderroot')}</m:FolderIds></m:GetFolder>`,
);
add('folderMessage', 'getAll', 'FindItem', [], (p, c) => findItems(p, c, 'inbox'));
add('message', 'send', 'CreateItem', ['write', 'send'], (p, c) => {
  if (![...(p.to || []), ...(p.cc || []), ...(p.bcc || [])].length)
    fail('At least one recipient is required.');
  return createItem('Message', p, c, 'SendAndSaveCopy');
});
add(
  'draft',
  'send',
  'SendItem',
  ['send'],
  (p, c) =>
    `<m:SendItem SaveItemToFolder="true"><m:ItemIds>${itemId(p, true)}</m:ItemIds><m:SavedItemFolderId>${folder({ folder: 'sentitems' }, c)}</m:SavedItemFolderId></m:SendItem>`,
);
for (const [op, object] of [
  ['reply', 'ReplyToItem'],
  ['replyAll', 'ReplyAllToItem'],
  ['forward', 'ForwardItem'],
])
  add(
    'message',
    op,
    'CreateItem',
    ['write', 'send'],
    (p) =>
      `<m:CreateItem MessageDisposition="${choice(p.disposition, ['SaveOnly', 'SendAndSaveCopy'], 'SaveOnly')}"><m:Items><t:${object}>${p.subject ? tag('t:Subject', p.subject) : ''}${p.to ? `<t:ToRecipients>${recipients(p.to)}</t:ToRecipients>` : ''}<t:ReferenceItemId Id="${x(str(p, 'itemId', 4096))}" ChangeKey="${x(str(p, 'changeKey', 4096))}"/><t:NewBodyContent BodyType="${choice(p.bodyType, ['Text', 'HTML'], 'Text')}">${x(str(p, 'body'))}</t:NewBodyContent></t:${object}></m:Items></m:CreateItem>`,
  );
for (const op of ['move', 'copy'])
  add(
    'message',
    op,
    op === 'move' ? 'MoveItem' : 'CopyItem',
    ['write'],
    (p, c) =>
      `<m:${op === 'move' ? 'MoveItem' : 'CopyItem'}><m:ToFolderId>${folder({ folderId: str(p, 'destinationFolderId', 4096) }, c)}</m:ToFolderId><m:ItemIds>${itemId(p)}</m:ItemIds></m:${op === 'move' ? 'MoveItem' : 'CopyItem'}>`,
  );
add('message', 'markRead', 'UpdateItem', ['write'], (p) =>
  updateItem('Message', { ...p, isRead: bool(p.isRead, true) }),
);
add(
  'message',
  'junk',
  'MarkAsJunk',
  ['write'],
  (p) =>
    `<m:MarkAsJunk IsJunk="${bool(p.isJunk, true)}" MoveItem="${bool(p.moveItem, true)}"><m:ItemIds>${itemId(p)}</m:ItemIds></m:MarkAsJunk>`,
);
add(
  'message',
  'archive',
  'ArchiveItem',
  ['write'],
  (p, c) =>
    `<m:ArchiveItem><m:ArchiveSourceFolderId>${folder(p, c)}</m:ArchiveSourceFolderId><m:ItemIds>${itemId(p)}</m:ItemIds></m:ArchiveItem>`,
);
add('message', 'exportMime', 'GetItem', [], (p) => getItem({ ...p, mime: true }));
for (const r of ['folder', 'calendar']) {
  const ft = r === 'calendar' ? 'CalendarFolder' : 'Folder',
    fallback = r === 'calendar' ? 'calendar' : 'msgfolderroot';
  add(
    r,
    'get',
    'GetFolder',
    [],
    (p, c) =>
      `<m:GetFolder><m:FolderShape><t:BaseShape>AllProperties</t:BaseShape></m:FolderShape><m:FolderIds>${folder(p, c, fallback)}</m:FolderIds></m:GetFolder>`,
  );
  add(
    r,
    'getAll',
    'FindFolder',
    [],
    (p, c) =>
      `<m:FindFolder Traversal="${choice(p.traversal, ['Shallow', 'Deep'], 'Deep')}"><m:FolderShape><t:BaseShape>AllProperties</t:BaseShape></m:FolderShape><m:IndexedPageFolderView MaxEntriesReturned="${number(p.limit, 100, 1, 1000)}" Offset="${number(p.offset, 0, 0, 1000000)}" BasePoint="Beginning"/>${r === 'calendar' ? '<m:Restriction><t:IsEqualTo><t:FieldURI FieldURI="folder:FolderClass"/><t:FieldURIOrConstant><t:Constant Value="IPF.Appointment"/></t:FieldURIOrConstant></t:IsEqualTo></m:Restriction>' : ''}<m:ParentFolderIds>${folder(p, c, 'msgfolderroot')}</m:ParentFolderIds></m:FindFolder>`,
  );
  add(
    r,
    'create',
    'CreateFolder',
    ['write'],
    (p, c) =>
      `<m:CreateFolder><m:ParentFolderId>${folder(p, c, 'msgfolderroot')}</m:ParentFolderId><m:Folders><t:${ft}>${tag('t:DisplayName', str(p, 'displayName', 255))}</t:${ft}></m:Folders></m:CreateFolder>`,
  );
  add(
    r,
    'update',
    'UpdateFolder',
    ['write'],
    (p) =>
      `<m:UpdateFolder><m:FolderChanges><t:FolderChange><t:FolderId Id="${x(str(p, 'folderId', 4096))}" ChangeKey="${x(str(p, 'changeKey', 4096))}"/><t:Updates><t:SetFolderField>${field('folder:DisplayName')}<t:${ft}>${tag('t:DisplayName', str(p, 'displayName', 255))}</t:${ft}></t:SetFolderField></t:Updates></t:FolderChange></m:FolderChanges></m:UpdateFolder>`,
  );
  add(
    r,
    'delete',
    'DeleteFolder',
    ['delete'],
    (p, c) =>
      `<m:DeleteFolder DeleteType="${choice(p.deleteType, ['MoveToDeletedItems', 'SoftDelete', 'HardDelete'], 'MoveToDeletedItems')}"><m:FolderIds>${folder({ folderId: str(p, 'folderId', 4096) }, c)}</m:FolderIds></m:DeleteFolder>`,
  );
}
for (const op of ['move', 'copy'])
  add(
    'folder',
    op,
    op === 'move' ? 'MoveFolder' : 'CopyFolder',
    ['write'],
    (p, c) =>
      `<m:${op === 'move' ? 'MoveFolder' : 'CopyFolder'}><m:ToFolderId>${folder({ folderId: str(p, 'destinationFolderId', 4096) }, c)}</m:ToFolderId><m:FolderIds>${folder({ folderId: str(p, 'folderId', 4096) }, c)}</m:FolderIds></m:${op === 'move' ? 'MoveFolder' : 'CopyFolder'}>`,
  );
add(
  'folder',
  'empty',
  'EmptyFolder',
  ['delete'],
  (p, c) =>
    `<m:EmptyFolder DeleteType="${choice(p.deleteType, ['SoftDelete', 'HardDelete'], 'SoftDelete')}" DeleteSubFolders="${bool(p.deleteSubFolders)}"><m:FolderIds>${folder({ folderId: str(p, 'folderId', 4096) }, c)}</m:FolderIds></m:EmptyFolder>`,
);
add('attachment', 'getAll', 'GetItem', [], getItem);
for (const op of ['get', 'download'])
  add(
    'attachment',
    op,
    'GetAttachment',
    [],
    (p) =>
      `<m:GetAttachment><m:AttachmentShape><t:IncludeMimeContent>true</t:IncludeMimeContent><t:BodyType>Text</t:BodyType></m:AttachmentShape><m:AttachmentIds><t:AttachmentId Id="${x(str(p, 'attachmentId', 8192))}"/></m:AttachmentIds></m:GetAttachment>`,
  );
add('attachment', 'add', 'CreateAttachment', ['write'], (p) => {
  const b64 = str(p, 'contentBase64', 40 * 1024 * 1024);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64))
    fail('Invalid attachment base64.');
  return `<m:CreateAttachment><m:ParentItemId Id="${x(str(p, 'itemId', 4096))}" ChangeKey="${x(str(p, 'changeKey', 4096))}"/><m:Attachments><t:FileAttachment>${tag('t:Name', str(p, 'fileName', 255))}${p.contentType ? tag('t:ContentType', p.contentType) : ''}${p.contentId ? tag('t:ContentId', p.contentId) : ''}${tag('t:IsInline', bool(p.isInline))}${tag('t:Content', b64)}</t:FileAttachment></m:Attachments></m:CreateAttachment>`;
});
add(
  'attachment',
  'delete',
  'DeleteAttachment',
  ['delete'],
  (p) =>
    `<m:DeleteAttachment><m:AttachmentIds><t:AttachmentId Id="${x(str(p, 'attachmentId', 8192))}"/></m:AttachmentIds></m:DeleteAttachment>`,
);
registry['event.getAll'].build = (p, c) => {
  date(p.start);
  date(p.end);
  if (
    Date.parse(p.end) <= Date.parse(p.start) ||
    Date.parse(p.end) - Date.parse(p.start) > 366 * 86400000
  )
    fail('Calendar range must be positive and at most 366 days.');
  return `<m:FindItem Traversal="Shallow">${shape(p, 'IdOnly', ['item:Subject', 'calendar:Start', 'calendar:End', 'calendar:Location', 'calendar:Organizer'])}<m:CalendarView MaxEntriesReturned="${number(p.limit, 100, 1, 1000)}" StartDate="${x(p.start)}" EndDate="${x(p.end)}"/><m:ParentFolderIds>${folder(p, c, 'calendar')}</m:ParentFolderIds></m:FindItem>`;
};
add('event', 'respond', 'CreateItem', ['write', 'send'], (p) => {
  const object = choice(p.response, ['AcceptItem', 'TentativelyAcceptItem', 'DeclineItem']);
  return `<m:CreateItem MessageDisposition="${bool(p.sendResponse, true) ? 'SendAndSaveCopy' : 'SaveOnly'}"><m:Items><t:${object}>${body(p)}<t:ReferenceItemId Id="${x(str(p, 'itemId', 4096))}" ChangeKey="${x(str(p, 'changeKey', 4096))}"/></t:${object}></m:Items></m:CreateItem>`;
});
add(
  'event',
  'cancel',
  'CreateItem',
  ['write', 'send'],
  (p) =>
    `<m:CreateItem MessageDisposition="SendAndSaveCopy"><m:Items><t:CancelCalendarItem><t:ReferenceItemId Id="${x(str(p, 'itemId', 4096))}" ChangeKey="${x(str(p, 'changeKey', 4096))}"/>${p.body ? `<t:NewBodyContent BodyType="Text">${x(p.body)}</t:NewBodyContent>` : ''}</t:CancelCalendarItem></m:Items></m:CreateItem>`,
);
add(
  'directory',
  'resolveNames',
  'ResolveNames',
  [],
  (p) =>
    `<m:ResolveNames ReturnFullContactData="true" SearchScope="${choice(p.scope, ['ActiveDirectory', 'ActiveDirectoryContacts', 'Contacts', 'ContactsActiveDirectory'], 'ActiveDirectoryContacts')}">${tag('m:UnresolvedEntry', str(p, 'query', 1024))}</m:ResolveNames>`,
);
add(
  'directory',
  'expandList',
  'ExpandDL',
  [],
  (p) => `<m:ExpandDL><m:Mailbox>${tag('t:EmailAddress', email(p.email))}</m:Mailbox></m:ExpandDL>`,
);
add('availability', 'roomLists', 'GetRoomLists', [], () => '<m:GetRoomLists/>');
add(
  'availability',
  'rooms',
  'GetRooms',
  [],
  (p) =>
    `<m:GetRooms><m:RoomList>${tag('t:EmailAddress', email(p.email))}</m:RoomList></m:GetRooms>`,
);
add('availability', 'get', 'GetUserAvailability', [], (p) => {
  date(p.start);
  date(p.end);
  if (
    Date.parse(p.end) <= Date.parse(p.start) ||
    Date.parse(p.end) - Date.parse(p.start) > 62 * 86400000
  )
    fail('Availability window must be positive and at most 62 days.');
  return `<m:GetUserAvailabilityRequest><m:MailboxDataArray>${list(p.emails, 100)
    .map(
      (e) =>
        `<t:MailboxData><t:Email>${tag('t:Address', email(e))}</t:Email><t:AttendeeType>Required</t:AttendeeType><t:ExcludeConflicts>false</t:ExcludeConflicts></t:MailboxData>`,
    )
    .join(
      '',
    )}</m:MailboxDataArray><t:FreeBusyViewOptions><t:TimeWindow>${tag('t:StartTime', p.start)}${tag('t:EndTime', p.end)}</t:TimeWindow>${tag('t:MergedFreeBusyIntervalInMinutes', number(p.interval, 30, 5, 1440))}<t:RequestedView>DetailedMerged</t:RequestedView></t:FreeBusyViewOptions></m:GetUserAvailabilityRequest>`;
});
add(
  'settings',
  'getOof',
  'GetUserOofSettings',
  [],
  (p, c) =>
    `<m:GetUserOofSettingsRequest><t:Mailbox>${tag('t:Address', c.mailbox)}</t:Mailbox></m:GetUserOofSettingsRequest>`,
);
add(
  'settings',
  'setOof',
  'SetUserOofSettings',
  ['write'],
  (p, c) =>
    `<m:SetUserOofSettingsRequest><t:Mailbox>${tag('t:Address', c.mailbox)}</t:Mailbox><t:UserOofSettings>${tag('t:OofState', choice(p.state, ['Disabled', 'Enabled', 'Scheduled']))}${tag('t:ExternalAudience', choice(p.externalAudience, ['None', 'Known', 'All'], 'None'))}${p.state === 'Scheduled' ? `<t:Duration>${tag('t:StartTime', date(p.start))}${tag('t:EndTime', date(p.end))}</t:Duration>` : ''}<t:InternalReply>${tag('t:Message', p.internalReply || '')}</t:InternalReply><t:ExternalReply>${tag('t:Message', p.externalReply || '')}</t:ExternalReply></t:UserOofSettings></m:SetUserOofSettingsRequest>`,
);
add(
  'settings',
  'getRules',
  'GetInboxRules',
  [],
  (p, c) => `<m:GetInboxRules>${tag('m:MailboxSmtpAddress', c.mailbox)}</m:GetInboxRules>`,
);
add(
  'settings',
  'timeZones',
  'GetServerTimeZones',
  [],
  () => '<m:GetServerTimeZones ReturnFullTimeZoneData="true"/>',
);
add(
  'settings',
  'retentionTags',
  'GetUserRetentionPolicyTags',
  [],
  () => '<m:GetUserRetentionPolicyTags/>',
);
add(
  'delegate',
  'get',
  'GetDelegate',
  [],
  (p, c) =>
    `<m:GetDelegate IncludePermissions="true"><m:Mailbox>${tag('t:EmailAddress', c.mailbox)}</m:Mailbox></m:GetDelegate>`,
);
add(
  'sync',
  'items',
  'SyncFolderItems',
  [],
  (p, c) =>
    `<m:SyncFolderItems>${shape(p, 'IdOnly')}<m:SyncFolderId>${folder(p, c)}</m:SyncFolderId>${p.syncState ? tag('m:SyncState', str(p, 'syncState', 100000)) : ''}${tag('m:MaxChangesReturned', number(p.limit, 100, 1, 512))}<m:SyncScope>NormalItems</m:SyncScope></m:SyncFolderItems>`,
);
add(
  'sync',
  'hierarchy',
  'SyncFolderHierarchy',
  [],
  (p, c) =>
    `<m:SyncFolderHierarchy><m:FolderShape><t:BaseShape>AllProperties</t:BaseShape></m:FolderShape><m:SyncFolderId>${folder(p, c, 'msgfolderroot')}</m:SyncFolderId>${p.syncState ? tag('m:SyncState', str(p, 'syncState', 100000)) : ''}</m:SyncFolderHierarchy>`,
);
add(
  'subscription',
  'create',
  'Subscribe',
  ['write'],
  (p, c) =>
    `<m:Subscribe><m:PullSubscriptionRequest><t:FolderIds>${folder(p, c)}</t:FolderIds><t:EventTypes>${list(
      p.events || ['NewMailEvent'],
      8,
    )
      .map((v) =>
        tag(
          't:EventType',
          choice(v, [
            'CopiedEvent',
            'CreatedEvent',
            'DeletedEvent',
            'ModifiedEvent',
            'MovedEvent',
            'NewMailEvent',
            'FreeBusyChangedEvent',
          ]),
        ),
      )
      .join(
        '',
      )}</t:EventTypes>${p.watermark ? tag('t:Watermark', p.watermark) : ''}${tag('t:Timeout', number(p.minutes, 30, 1, 1440))}</m:PullSubscriptionRequest></m:Subscribe>`,
);
add(
  'subscription',
  'events',
  'GetEvents',
  [],
  (p) =>
    `<m:GetEvents>${tag('m:SubscriptionId', str(p, 'subscriptionId', 4096))}${tag('m:Watermark', str(p, 'watermark', 4096))}</m:GetEvents>`,
);
add(
  'subscription',
  'delete',
  'Unsubscribe',
  ['write'],
  (p) =>
    `<m:Unsubscribe>${tag('m:SubscriptionId', str(p, 'subscriptionId', 4096))}</m:Unsubscribe>`,
);
add('advanced', 'execute', null, ['advanced'], (p) => {
  const op = choice(p.ewsOperation, ewsOperations),
    xml = str(p, 'bodyXml', 32 * 1024 * 1024);
  // The supplied fragment is one SOAP-body element only. Headers and destinations are credential-owned.
  const wrapped = `<root xmlns:m="${NS.m}" xmlns:t="${NS.t}">${xml}</root>`;
  const parsed = parse(wrapped).root;
  const expected = ['GetUserAvailability', 'GetUserOofSettings', 'SetUserOofSettings'].includes(op)
    ? op + 'Request'
    : op;
  const roots = Object.keys(parsed || {}).filter((k) => k !== '$' && k !== '_');
  if (
    roots.length !== 1 ||
    roots[0] !== expected ||
    Array.isArray(parsed[expected]) ||
    /<\??(?:[A-Za-z_][\w.-]*:)?(?:Envelope|Header|Body)\b/i.test(xml)
  )
    fail('Advanced XML must contain exactly the selected EWS body element.');
  if (op === 'GetStreamingEvents') {
    const timeout = Number(require('./xml').scalar(parsed[expected].ConnectionTimeout));
    if (!Number.isInteger(timeout) || timeout !== 1)
      fail('Buffered streaming requests require ConnectionTimeout 1 minute.');
  }
  return xml;
});
function request(action, p, c) {
  const definition = Object.hasOwn(registry, action) ? registry[action] : null;
  if (!definition) fail('Unknown resource or operation.');
  const soap = definition.soap || p.ewsOperation;
  const bodyXml = definition.build(p, c);
  const effects = [...definition.effects];
  if (action === 'settings.setOof' && p.state !== 'Disabled') effects.push('send');
  if (
    (p.invitations && p.invitations !== 'SendToNone') ||
    (p.cancellations && p.cancellations !== 'SendToNone')
  )
    effects.push('send');
  return {
    xml: envelope(bodyXml, c),
    soapAction: NS.m + '/' + soap,
    soapOperation: soap,
    effects: [...new Set(effects)],
    preflight: action === 'draft.update' || action === 'draft.send',
    streaming: soap === 'GetStreamingEvents',
  };
}
module.exports = {
  registry,
  request,
  itemId,
  getItem,
  str,
  number,
  choice,
  bool,
  email,
  date,
  list,
  folder,
  recurrence,
};
