# Feature inventory and Outlook comparison

This is operation-level coverage, not drop-in Microsoft Graph compatibility. EWS has
its own identifiers, fields, server versions and permissions. The comparison baseline
is the operation inventory in n8n's Microsoft Outlook v2 node inspected on 2026-10-02.
Graph-only properties, cloud-only APIs and Exchange server administration outside EWS
are not promised by this package.

| Outlook v2 resource | Baseline operations                          | Exchange implementation                                                  |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Message             | Get, list, update, delete, move, reply, send | Prepared Message operations                                              |
| Message             | Send and wait                                | Dedicated Exchange Send and Wait node: approval, free text, custom form  |
| Draft               | Create, get, update, delete, send            | Prepared Draft operations, update/send preflight                         |
| Message attachment  | Add, get, list, download                     | Prepared Attachment operations; standard n8n binary input/output         |
| Folder              | Create, get, list, update, delete            | Prepared Folder operations                                               |
| Folder message      | List                                         | Folder Message → Get All                                                 |
| Calendar            | Create, get, list, update, delete            | Calendar folders via EWS                                                 |
| Event               | Create, get, list, update, delete            | Prepared Event operations; date-window list                              |
| Contact             | Create, get, list, update, delete            | Prepared Contact operations                                              |
| Outlook trigger     | New mail                                     | Change trigger on Inbox/Create; also supports other folders/change types |

The operation inventory is asserted automatically against the package registry.
Property coverage is intentionally narrower in the prepared JSON helpers: common
properties have convenient parameters; extended/indexed properties and other EWS
fields can be supplied through Advanced EWS. For example, advanced contact updates
cover indexed addresses and phones not exposed by the simple update helper. Reply
and forward default to creating a draft; select `disposition: SendAndSaveCopy` to send.

## Additional prepared functions

- Reply-all, forward, copy, mark read/unread, mark junk, archive, MIME export.
- Folder copy/move/empty; attachment deletion.
- Task create/read/list/update/delete, status and percent complete.
- Recurring events (daily/weekly/absolute monthly/yearly), attendees/resources,
  availability status, time zones, meeting response and cancellation.
- Free/busy, room lists, rooms, ambiguous-name resolution and distribution-list expansion.
- Out-of-office settings, inbox-rule reading, delegate reading, time-zone and retention-tag lists.
- Folder/item synchronization and pull notification subscriptions.

## Advanced EWS coverage

`advanced.execute` accepts exactly one selected EWS body element. The catalog contains
95 documented names, including all prepared operations' underlying EWS methods plus:

- Conversations and conversation actions.
- Inbox-rule changes, delegates and mailbox sharing.
- Extended properties, indexed contact fields, MIME import and item attachments.
- Reminders, user configuration, retention tags and service configuration.
- Bulk export/upload, eDiscovery, holds and searchable-mailbox queries.
- Pull/push/streaming subscription SOAP requests, personas, photos and ID conversion.
- Version-specific add-in, unified-messaging and IM operations from the Microsoft catalog.

This interface transports caller-authored XML; it does not generate every schema
variant or grant server rights. Some catalog operations are retired, unavailable on
certain server editions, or require administrator roles. The service's response is
authoritative. Push subscriptions can be created with advanced XML, but a push webhook
receiver is not included; use an appropriate n8n Webhook workflow. Buffered streaming
reads are limited to one-minute requests and are not a persistent streaming daemon.
The included native trigger uses synchronization polling instead.

## Authentication and interoperability

| Capability                                                                | Status                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| NTLMv2 with MIC and TLS channel binding                                   | Implemented, vector/TLS tests pass; IIS live test still required        |
| Private CA and shared mailbox                                             | Configurable; server permissions required                               |
| EWS impersonation                                                         | Explicit admin opt-in; server application-impersonation rights required |
| Basic over HTTPS                                                          | Implemented; enabled only when explicitly selected                      |
| External EWS bearer token                                                 | Implemented; no token acquisition/refresh                               |
| Kerberos/SPNEGO or Autodiscover                                           | Not implemented                                                         |
| n8n binary data and downstream file/OCR nodes                             | Implemented at binary interface; parser choice belongs to workflow      |
| AI tool use                                                               | Action node enabled; credential grants restrict calls                   |
| Outlook Graph IDs, Graph-only fields, Microsoft 365 tenant administration | Outside the on-premises EWS interface                                   |

Reference: [n8n Outlook source](https://github.com/n8n-io/n8n/tree/master/packages/nodes-base/nodes/Microsoft/Outlook/v2/actions),
[Microsoft EWS catalog](https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/ews-operations-in-exchange).
