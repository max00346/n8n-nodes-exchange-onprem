# Changelog

## 0.2.0-rc.1

Initial general-purpose release candidate, derived from a private proof of concept.

- Three native nodes: operations, synchronized change polling, send and wait.
- 74 convenience actions and advanced SOAP access to the 95-operation EWS catalog.
- NTLMv2 with MIC/channel binding, explicit Basic and externally supplied bearer tokens.
- Mail, drafts, attachments, folders, calendars, events, contacts, tasks, directories,
  free/busy, rooms, out-of-office settings, rules reading, delegates reading, sync and pull subscriptions.
- Binary interoperability, paging, draft concurrency checks and separate write capabilities.
- Generic documentation, example workflows, package/loader checks and GitHub Actions CI.

This is a release candidate: real Exchange version coverage and full n8n runtime
integration require the live acceptance tests described in docs/AUDIT.md.
