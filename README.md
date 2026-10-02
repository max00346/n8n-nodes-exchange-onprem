# n8n-nodes-exchange-onprem

Native community nodes for **on-premises Microsoft Exchange Web Services (EWS)**.
Connect n8n directly to Exchange without a bridge or adapter service.

**Version 0.2.0-rc.1 is a release candidate.** Local protocol, transport, node-loader
and package tests pass. Production dependency auditing is clean; the development-only
n8n SDK tree has 33 affected packages, documented in the audit. The deployed n8n host
needs its own version review. Live interoperability with your Exchange deployment must
be verified before production use. This project does not claim Microsoft or n8n certification.

## Included nodes

| Node                             | Purpose                                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exchange On-Premises**         | 74 prepared operations for mail, drafts, folders, attachments, calendars, events, contacts, tasks, availability, directory lookup, settings, delegates, synchronization and subscriptions |
| **Exchange On-Premises Trigger** | Poll item creation, updates, deletions and read-status changes using EWS synchronization state                                                                                            |
| **Exchange Send and Wait**       | Send email and wait for approval, free text or a custom form, with expiring signed response links                                                                                         |

The **Advanced EWS** operation accepts a SOAP body for any of the **95 operations**
in Microsoft's published EWS catalog. This provides access to extended properties,
inbox rules, delegates, search/eDiscovery, reminders, conversations, configuration,
sharing, import/export and other server-supported EWS features. These are raw XML
operations, not 95 separately tested UI forms. Availability depends on the server
version, installed components and account permissions.

[Operation reference](docs/OPERATIONS.md) · [Feature matrix](docs/FEATURE_MATRIX.md) ·
[Installation](docs/INSTALLATION.md) · [Audit and acceptance tests](docs/AUDIT.md) ·
[Security](SECURITY.md)

## Authentication

- **NTLMv2** with a cryptographic nonce, server timestamp, MIC, and TLS channel binding.
- **Basic over HTTPS**, selected explicitly when permitted by the server.
- **Bearer token** issued for the EWS service, supplied externally; token acquisition
  and automatic refresh are not implemented.
- Optional private CA certificates, shared/delegated mailbox targeting, and explicit
  EWS impersonation when authorized by Exchange.

HTTPS certificate validation stays enabled. There is no NTLMv1 fallback or automatic
redirect following. Kerberos/SPNEGO, Autodiscover and generic forward-proxy support
are outside this release. The endpoint is configured explicitly.

## Install locally

Use Node.js 22 or 24 and an n8n installation compatible with this package. Loader
verification uses `n8n-core 2.41.4` / `n8n-workflow 2.41.2`; the complete n8n backend
and UI still require deployment-specific acceptance testing.

```sh
npm ci --ignore-scripts
npm run check
npm pack
```

Install the resulting archive into the n8n user's persistent community-node directory:

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install --ignore-scripts /absolute/path/n8n-nodes-exchange-onprem-0.2.0-rc.1.tgz
```

Restart n8n after checking running executions. In queue mode, install the same version
on the main instance and every worker. See [installation](docs/INSTALLATION.md) for
Docker, private custom-extension loading, upgrades and rollback.

The source repository is [max00346/n8n-nodes-exchange-onprem](https://github.com/max00346/n8n-nodes-exchange-onprem).
After the candidate is published to npm, install this exact version from n8n's
**Settings → Community nodes → Install**:

```text
n8n-nodes-exchange-onprem@0.2.0-rc.1
```

The candidate uses npm's `next` tag. Pinning the version makes the test installation
explicit. Package installation must be enabled on the self-hosted n8n instance.

## Create credentials

Create **Exchange On-Premises EWS** credentials with your own endpoint, username,
Windows domain and target mailbox. No customer-specific values are embedded.
Select them in the action node and use the credential test, or choose **Connection → Test**.

Write capabilities are disabled initially. Enable only the capabilities needed by
the workflow. The node's **Confirm Requested Change** setting must also be enabled
for mutating operations. This is an application guard, not a separate authorization service.

For Send and Wait, configure n8n's public HTTPS webhook URL and a separate random
**Response Signing Secret** of at least 32 characters. Do not reuse the mailbox password.
Anyone holding an unexpired response link can answer; the link does not authenticate
recipient identity. GET displays a form, POST submits it.

## Use with other n8n nodes

**Parameters (JSON)** supports expressions. For example:

```json
{ "query": "subject:invoice", "limit": 25, "returnAll": true, "maxPages": 10 }
```

Responses include `items`, the EWS `data`, `account`, `paging`, `complete`, and
`contentIsUntrusted`. Set `splitResults: true` to emit one n8n item per result.
Identifiers appear in EWS form, for example `data.ItemId.$.Id` after splitting results.
Exchange EWS IDs and Microsoft Graph IDs are not interchangeable.

**Attachment → Download** and **Message → Export Mime** emit standard n8n binary
properties. Connect them to Extract From File, file storage, OCR or other document
nodes. **Attachment → Add** accepts n8n binary input. PDF/Office/OCR processing is
delegated to downstream nodes; the package does not claim an embedded document parser.

[Six inactive, credential-free examples](examples/) cover mail search, full messages,
PDF extraction, new-mail polling, an approval request, a calendar window and advanced EWS.
All write confirmations in examples are off.

## Reliability

- Searches page by index and expose incomplete results when a page cap is reached.
- Calendar views require a date window. Narrow the window when Exchange truncates it.
- Draft update/send performs a fresh read and checks `IsDraft` and `ChangeKey`.
- Item updates use `NeverOverwrite`; handles from old reads must be refreshed.
- The trigger preserves its sync cursor on failure and resets it when the target changes.
- Delivery is at least once. Downstream actions should be idempotent.
- Writes are never retried automatically. A timeout or partial batch error can leave an
  uncertain outcome; read back before repeating the operation.

See [the audit](docs/AUDIT.md) for exactly what was verified and what remains a live-test gate.

## Publish

The repository contains an MIT license, documentation, examples, tests, a locked
build dependency tree and GitHub Actions checks for Node 22/24. The repository URL
and private vulnerability-reporting channel are configured. Follow
[the release procedure](docs/INSTALLATION.md#publishing). Do not publish a stable `latest`
release until live acceptance checks pass; this candidate belongs on the `next` tag.

## References

- [Microsoft EWS operation catalog](https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/ews-operations-in-exchange)
- [Microsoft EWS schema versions](https://learn.microsoft.com/en-us/exchange/client-developer/exchange-web-services/ews-schema-versions-in-exchange)
- [Microsoft NTLM specification](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp/)
- [TLS channel binding, RFC 5929](https://www.rfc-editor.org/rfc/rfc5929)
- [n8n custom-node development](https://docs.n8n.io/integrations/creating-nodes/overview/)

MIT licensed. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
