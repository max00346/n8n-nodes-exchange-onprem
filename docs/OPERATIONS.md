# Operation and parameter reference

Choose Resource/Operation in the node. Put operation-specific values into **Parameters
(JSON)**. The parameters below use camelCase. Enable the node's confirmation setting
for changes; a `confirm` value inside JSON does not override the node's separate switch.
Programmatic clients using `execute()` supply `confirm: true` explicitly.

## Common fields

| Field                       | Meaning                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `itemId`, `changeKey`       | EWS IDs from a previous response; required for guarded updates and draft send |
| `folderId`                  | Explicit EWS folder ID; overrides a distinguished folder name                 |
| `folder`                    | e.g. inbox, sentitems, drafts, calendar, contacts, tasks, msgfolderroot       |
| `query`                     | EWS QueryString/AQS query; Exchange language/indexing behavior applies        |
| `limit`, `offset`           | Indexed list page size 1–1000 and offset; server may enforce smaller limits   |
| `returnAll`, `maxPages`     | Fetch indexed pages, bounded by 1–1000 pages, default cap 100                 |
| `splitResults`              | Emit one n8n item per collection result instead of one response envelope      |
| `bodyType`                  | Text/HTML for writes; Text/HTML/Best for reads; default Text                  |
| `subject`, `body`           | Subject up to 998 characters, body up to 200000 characters                    |
| `categories`                | Array of category strings                                                     |
| `importance`, `sensitivity` | Low/Normal/High and Normal/Personal/Private/Confidential                      |
| `binaryProperty`            | n8n binary input/output field, default `data`                                 |

Do not set `returnAll` on mutations. It is intended for list operations. Responses
retain EWS element names and `$` attribute objects. `complete: false` plus `paging`
indicates a truncated search; absence of a paging object is not a completeness claim
about arbitrary advanced API scopes. EWS operations return only what that operation requests.

## Mail and drafts

- **Get:** `itemId`; optional `bodyType`. **Get All:** query, paging and folder fields.
- **Send / Draft Create:** `subject`, optional `body`, `to`, `cc`, `bcc` arrays. Send
  requires at least one recipient. Optional `readReceipt`, `deliveryReceipt`.
- **Update:** `itemId`, `changeKey` and changed fields: subject/body/categories/importance/
  sensitivity/to/cc/bcc/isRead. Draft update checks the live draft before modifying it.
- **Draft Send:** `itemId`, `changeKey`; verifies that the message remains an unsent draft.
- **Reply / Reply All / Forward:** `itemId`, `changeKey`, `body`, optional subject/to.
  `disposition` is `SaveOnly` by default or `SendAndSaveCopy`. Forward needs recipients
  for sending. These actions require send permission even when creating a reply draft.
- **Move / Copy:** `itemId`, `destinationFolderId`.
- **Mark Read:** `itemId`, `changeKey`, `isRead` (default true).
- **Junk:** `itemId`, `isJunk` (default true), `moveItem` (default true).
- **Archive:** `itemId` plus the source folder; archive availability is server-dependent.
- **Export Mime:** `itemId`; outputs `message.eml` as n8n binary.
- **Delete:** `itemId`, optional `deleteType`: MoveToDeletedItems (default), SoftDelete,
  HardDelete. Recovery depends on Exchange retention configuration.

Get is a read operation: it does not mark messages as read. Search retrieves summary
fields, while Get retrieves the complete EWS item including its body and attachment metadata.

## Attachments

- **Get All:** parent `itemId`; returns attachment descriptors.
- **Get:** `attachmentId`; returns EWS content and metadata in JSON.
- **Download:** `attachmentId`, optional `binaryProperty`; emits binary and safe filename metadata.
- **Add:** parent `itemId`, current `changeKey`, n8n binary input. Optional `fileName`,
  `contentType`, `contentId`, `isInline`. Programmatic clients may use `contentBase64`.
- **Delete:** `attachmentId`.

The convenience download handles file attachments. Embedded Outlook item attachments
remain available in the raw Get response/Advanced EWS. File text extraction, OCR,
malware scanning and document editing belong to downstream tools. Inline attachments
require a matching HTML content ID in the message body.

## Folders and calendars

Calendars are EWS calendar folders, not Graph calendar groups.

- **Get / Get All:** folder selection and paging; list traversal Shallow/Deep (default Deep).
- **Create:** `displayName`, optional parent `folderId`/`folder`. Defaults to msgfolderroot.
- **Update:** `folderId`, `changeKey`, `displayName`.
- **Delete:** `folderId`, optional deleteType.
- **Folder Move / Copy:** `folderId`, `destinationFolderId`.
- **Folder Empty:** `folderId`, `deleteType` SoftDelete/HardDelete, `deleteSubFolders`.
- **Folder Message / Get All:** query, paging and folder fields.

Calendar Get All filters for IPF.Appointment folders. Permissions, extended folder
properties and managed folders can be controlled through Advanced EWS.

## Events and meetings

- **Get:** `itemId`.
- **Get All:** `start`, `end` (ISO date-time with timezone, positive window up to 366 days),
  optional `folderId`, `limit`. Calendar views cannot use indexed continuation; narrow
  a truncated time window. Recurrences are expanded by Exchange within the window.
- **Create:** `subject`, `start`, `end`; optional body, location, categories, isAllDay,
  showAs (Free/Tentative/Busy/OOF/WorkingElsewhere/NoData), requiredAttendees,
  optionalAttendees, resources (arrays of SMTP addresses), startTimeZone/endTimeZone
  (Windows timezone IDs), recurrence.
- **Update:** `itemId`, `changeKey` and supported changed fields: subject/body/location/
  start/end/isAllDay/showAs/categories/attendees/resources/importance/sensitivity.
- **Create/Update invitations:** SendToNone (default), SendOnlyToAll, SendToAllAndSaveCopy.
  Sending invitations requires the send capability.
- **Respond:** `itemId`, `changeKey`, `response` AcceptItem/TentativelyAcceptItem/DeclineItem;
  optional body and `sendResponse` (default true).
- **Cancel:** `itemId`, `changeKey`, optional body; sends a cancellation as organizer.
- **Delete:** itemId, deleteType, cancellations (same send modes, default SendToNone).

Recurring creation accepts, for example:

```json
{
  "recurrence": {
    "pattern": "weekly",
    "interval": 1,
    "days": ["Monday", "Thursday"],
    "startDate": "2026-10-05",
    "count": 10
  }
}
```

Patterns: daily; weekly with days; monthly with day 1–31; yearly with day and full English
month name. Supply count, endDate or neither for a non-ending series. Relative monthly/
yearly patterns, exceptions and advanced recurrence edits are available through raw EWS.

## Contacts and tasks

Contacts support create, get, list, update and delete. Creation fields include displayName,
givenName, middleName, surname, nickname, fileAs, companyName, department, jobTitle,
officeLocation, emailAddresses (up to three), phoneNumbers (dictionary using EWS keys such
as BusinessPhone, MobilePhone, HomePhone), plus common fields. Prepared update covers
givenName, surname, displayName, companyName, department, jobTitle and common fields;
use Advanced EWS for indexed phone/address changes and other contact properties.

Tasks support create/get/list/update/delete. Fields include subject/body, `start`, `due`,
`status` (NotStarted, InProgress, Completed, WaitingOnOthers, Deferred), `percentComplete`
(integer 0–100), importance and categories. Update requires itemId/changeKey. Deletion
can target AllOccurrences or SpecifiedOccurrenceOnly using `taskOccurrences`.

## Directory, availability and settings

- **Directory Resolve Names:** `query`, optional scope ActiveDirectory,
  ActiveDirectoryContacts, Contacts or ContactsActiveDirectory.
- **Directory Expand List:** distribution-list SMTP `email`.
- **Availability Room Lists:** no parameters. **Rooms:** room-list `email`.
- **Availability Get:** `emails` array, `start`, `end` (up to 62 days), `interval` in minutes
  (5–1440, default 30); returns detailed merged free/busy.
- **Settings Get Oof:** configured mailbox. **Set Oof:** state Disabled/Enabled/Scheduled,
  externalAudience None/Known/All, internalReply, externalReply; scheduled start/end.
  Enabling automatic replies also requires send permission.
- **Settings Get Rules:** configured mailbox.
- **Settings Time Zones / Retention Tags:** no parameters.
- **Delegate Get:** configured mailbox and current permissions. Delegate changes use Advanced EWS.

## Synchronization and subscriptions

- **Sync Items:** optional `syncState`, folder selection, `limit` 1–512.
- **Sync Hierarchy:** optional syncState and folder selection.
- **Subscription Create:** folder selection, events array (NewMailEvent, CreatedEvent,
  ModifiedEvent, DeletedEvent, MovedEvent, CopiedEvent, FreeBusyChangedEvent), minutes
  1–1440, optional watermark. Creates a pull subscription.
- **Subscription Events:** subscriptionId and watermark.
- **Subscription Delete:** subscriptionId.

The native trigger manages item sync state automatically. First poll suppresses
historical items unless enabled; manual testing emits a sample of existing changes
without modifying production state. Invalid/expired sync tokens cause a visible error;
reset the trigger's stored state deliberately after assessing backfill requirements.

## Advanced EWS

Supply `ewsOperation` from the packaged catalog and `bodyXml` containing one body
element. `m` and `t` namespaces are predefined. Envelope, headers, endpoint, credentials
and impersonation are controlled by the node/credential. No external entities or DTDs
are allowed. Validation checks well-formedness and the selected root, not complete XSD
conformance; the server validates operation-specific schema and permissions.

```json
{
  "ewsOperation": "GetInboxRules",
  "bodyXml": "<m:GetInboxRules><m:MailboxSmtpAddress>user@example.com</m:MailboxSmtpAddress></m:GetInboxRules>"
}
```

Enable `Allow Advanced EWS` only for trusted workflows and confirm the call. This is
**full credential authority** and can invoke sends/deletions/admin operations even if
those convenience-operation flags are off. This design avoids pretending that arbitrary
XML can be safely classified by a shallow check.

GetStreamingEvents is buffered and requires ConnectionTimeout = 1 minute. Multi-envelope
responses are returned under `data.streamingResponses`. A persistent push/stream receiver
is not provided. For all version-specific details use Microsoft's EWS operation reference.

## Catalog

Prepared operation identifiers:

- `message.get`
- `message.getAll`
- `message.update`
- `message.delete`
- `draft.get`
- `draft.getAll`
- `draft.update`
- `draft.delete`
- `draft.create`
- `event.get`
- `event.getAll`
- `event.update`
- `event.delete`
- `event.create`
- `contact.get`
- `contact.getAll`
- `contact.update`
- `contact.delete`
- `contact.create`
- `task.get`
- `task.getAll`
- `task.update`
- `task.delete`
- `task.create`
- `connection.test`
- `folderMessage.getAll`
- `message.send`
- `draft.send`
- `message.reply`
- `message.replyAll`
- `message.forward`
- `message.move`
- `message.copy`
- `message.markRead`
- `message.junk`
- `message.archive`
- `message.exportMime`
- `folder.get`
- `folder.getAll`
- `folder.create`
- `folder.update`
- `folder.delete`
- `calendar.get`
- `calendar.getAll`
- `calendar.create`
- `calendar.update`
- `calendar.delete`
- `folder.move`
- `folder.copy`
- `folder.empty`
- `attachment.getAll`
- `attachment.get`
- `attachment.download`
- `attachment.add`
- `attachment.delete`
- `event.respond`
- `event.cancel`
- `directory.resolveNames`
- `directory.expandList`
- `availability.roomLists`
- `availability.rooms`
- `availability.get`
- `settings.getOof`
- `settings.setOof`
- `settings.getRules`
- `settings.timeZones`
- `settings.retentionTags`
- `delegate.get`
- `sync.items`
- `sync.hierarchy`
- `subscription.create`
- `subscription.events`
- `subscription.delete`
- `advanced.execute`

Advanced operation names:

- `AddDelegate`
- `AddDistributionGroupToImList`
- `AddImContactToGroup`
- `AddImGroup`
- `AddNewImContactToGroup`
- `AddNewTelUriContactToGroup`
- `ApplyConversationAction`
- `ArchiveItem`
- `ConvertId`
- `CopyFolder`
- `CopyItem`
- `CreateAttachment`
- `CreateFolder`
- `CreateFolderPath`
- `CreateItem`
- `CreateManagedFolder`
- `CreateUserConfiguration`
- `DeleteAttachment`
- `DeleteFolder`
- `DeleteItem`
- `DeleteUserConfiguration`
- `DisableApp`
- `DisconnectPhoneCall`
- `EmptyFolder`
- `ExpandDL`
- `ExportItems`
- `FindConversation`
- `FindFolder`
- `FindItem`
- `FindMessageTrackingReport`
- `FindPeople`
- `GetAppManifests`
- `GetAppMarketplaceUrl`
- `GetAttachment`
- `GetClientAccessToken`
- `GetConversationItems`
- `GetDelegate`
- `GetDiscoverySearchConfiguration`
- `GetEvents`
- `GetFolder`
- `GetHoldOnMailboxes`
- `GetImItemList`
- `GetImItems`
- `GetInboxRules`
- `GetItem`
- `GetMailTips`
- `GetMessageTrackingReport`
- `GetNonIndexableItemDetails`
- `GetNonIndexableItemStatistics`
- `GetPasswordExpirationDate`
- `GetPersona`
- `GetPhoneCallInformation`
- `GetReminders`
- `GetRoomLists`
- `GetRooms`
- `GetSearchableMailboxes`
- `GetServerTimeZones`
- `GetServiceConfiguration`
- `GetSharingFolder`
- `GetSharingMetadata`
- `GetStreamingEvents`
- `GetUserAvailability`
- `GetUserConfiguration`
- `GetUserOofSettings`
- `GetUserPhoto`
- `GetUserRetentionPolicyTags`
- `InstallApp`
- `MarkAllItemsAsRead`
- `MarkAsJunk`
- `MoveFolder`
- `MoveItem`
- `PerformReminderAction`
- `RefreshSharingFolder`
- `RemoveContactFromImList`
- `RemoveDelegate`
- `RemoveDistributionGroupFromImList`
- `RemoveImContactFromGroup`
- `RemoveImGroup`
- `ResolveNames`
- `SearchMailboxes`
- `SendItem`
- `SetHoldOnMailboxes`
- `SetImGroup`
- `SetUserOofSettings`
- `Subscribe`
- `SyncFolderHierarchy`
- `SyncFolderItems`
- `UninstallApp`
- `Unsubscribe`
- `UpdateDelegate`
- `UpdateFolder`
- `UpdateInboxRules`
- `UpdateItem`
- `UpdateUserConfiguration`
- `UploadItems`
