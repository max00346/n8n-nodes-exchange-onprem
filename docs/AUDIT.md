# Release-candidate audit

Date: **2026-10-03**. Scope: source, authentication, request generation, credential
capabilities, responses, paging, synchronization, signed forms, node loading and package
contents. This is an engineering self-review with automated evidence, not an independent
penetration test or certification.

## Automated evidence

The release build runs `npm run check` and production dependency auditing. Tests cover:

- Every prepared operation's envelope and credential-owned routing.
- Outlook v2 operation inventory and the 95-name EWS catalog.
- NTLMv2 proof using the published Microsoft response-key vector and independent HMAC
  calculation, server timestamp, MIC, channel binding and unpredictable client challenges.
- Actual local HTTPS challenge/response transport: same socket, trusted/untrusted
  certificates, Basic/bearer modes, redirects, connection loss, timeout and response limit.
- Credential capability gates and explicit change confirmation, including invitations,
  deletions, advanced access and draft live-version checks.
- Malformed XML, DTD/entity rejection, SOAP errors, paging caps and invalid continuations.
- Synchronization cursor preservation, initial backfill suppression and target scoping.
- Signed response tokens, tampering/expiry/scope, escaped forms, bounded input and POST-only
  responses. A node-context integration test sends to a synthetic HTTPS server and exercises
  the GET/POST webhook handlers without sending real mail.
- Actual `n8n-core 2.41.4` package and custom-directory loaders, resolving all three nodes,
  icons and the credential type; `n8n-workflow 2.41.2` exports. The earlier
  `2.16.1` / `2.16.0` loader baseline also passed before the final dependency update.
- Generic release content, inactive credential-free example graphs and package manifests.
- The packed archive installs in an empty consumer directory and loads every export
  without auto-installing another n8n SDK; the consumer production audit has zero findings.

Exact test counts and archive checksums are recorded in `RELEASE_REPORT.json` next to
the deliverable archives. GitHub Actions is configured for Node 22/24; remote CI status
exists only after this repository is pushed. Local JavaScript tests are not a substitute
for a full n8n backend/reverse-proxy deployment test.

## Dependency audit finding

A clean consumer install initially auto-installed the n8n-workflow peer and reported
**five affected packages** (four high, one moderate), through the host SDK's dependencies:
`lodash`, `form-data`, `uuid`, `@n8n/expression-runtime` and `n8n-workflow`.
The package now marks that peer optional and uses the SDK supplied by the host, with
plain safe errors available in standalone use. It does not ship a second SDK runtime.
The package-owned production dependency tree is audited again after this change.

The final package-owned production dependency audit reports **zero advisories**.
The development-only n8n SDK/loader dependencies were updated to the registry's explicit
stable versions (`n8n-core 2.41.4`, `n8n-workflow 2.41.2`). The registry's `latest` tag
pointed to older versions at review time. The full development tree still reports
**33 affected packages: 22 moderate, 10 high and 1 critical**. These include Axios,
stream-json and the SDK's cloud-storage dependencies (including an older nested XML
parser). They are not runtime dependencies of the installable Exchange package.
No forced cross-major dependency replacements were applied to the n8n test environment.
The development audit JSON accompanies the release bundle so this finding is reviewable.

This packaging correction does **not** fix an existing n8n installation. Assess and
update the deployed n8n runtime separately; do not interpret a clean package dependency
audit as a clean audit of the whole n8n host. The source checkout's development environment
must remain isolated from untrusted workloads until the upstream findings are resolved.
This is an open audit finding and prevents an unqualified security-clean/stable claim.
Relevant advisory IDs: GHSA-r5fr-rjxr-66jc, GHSA-f23m-r3pf-42rh,
GHSA-hmw2-7cc7-3qxx and GHSA-w5hq-g745-h8pq.

## Findings addressed

- Replaced the prototype's limited NTLM helper with bounded NTLMv2 messages including
  MIC and actual-certificate TLS channel binding. Added independent proof tests.
- Removed customer endpoints, usernames, mailbox defaults, workflow IDs and credentials.
- Separated general writes, sends, deletions and advanced/admin capabilities. Enabled
  automatic replies also require send permission.
- Kept advanced XML behind a full-authority opt-in; it is not advertised as a restricted
  read-only tool. Headers, endpoint and impersonation are credential-owned.
- Preserved draft ChangeKey checks and disabled automatic write retries.
- Scoped trigger cursors to endpoint/account/folder; no state advancement on failed polls.
- Scoped response tokens to execution/node/expiry, added canonical signature validation,
  POST-only submission and a dedicated signing secret distinct from the mailbox password.
- Bound approval resume URLs to the waiting node ID; use n8n's native signed resume URL
  API when available. HTML text is escaped and form responses are bounded.
- Kept attachments in n8n's binary interface; stripped binary payloads from download JSON.

## Remaining live acceptance gates

No real Exchange password was available for this release. No live mailbox write, send,
delete, rule, delegate or administrative action has been performed. Before stable release:

1. Record exact Exchange build, EWS schema, n8n version, Node version and reverse-proxy setup.
2. Test NTLMv2 with MIC/channel binding against IIS with its intended Extended Protection
   policy. Check any TLS offload/SPN configuration without weakening server policy.
3. Test private CA handling and shared/delegated mailbox permissions. Test impersonation
   only with an explicitly authorized service account.
4. Read a known message, folder tree, attachment, contact, task and calendar recurrence;
   compare counts, dates, encodings, time zones and paging with the mailbox client.
5. On disposable objects, exercise create/update/copy/move/delete, stale ChangeKeys,
   draft send/reply/forward, attachments and meeting invitations/cancellation.
6. Activate the trigger, create/update/delete an item, restart n8n, simulate a failed poll
   and verify no loss. Downstream consumers must tolerate duplicate deliveries.
7. Test Send and Wait through the real n8n proxy: GET must not approve; POST must resume
   once; expiry, replay, parallel submissions, custom forms and timeout output must behave
   correctly. Response links are bearer capabilities, not recipient identity verification.
8. Use advanced EWS with representative allowed server operations and inspect partial
   batch errors. Do not call administrative actions merely to increase coverage.
9. Verify main/worker installations, rollback and execution-data access/retention.

## Deliberate boundaries

Prepared operation tests verify XML structure and behavior, not complete XSD conformance
of every possible parameter combination. The raw catalog is a transport surface, not a
claim that all 95 APIs exist on every Exchange server. Kerberos, Autodiscover, automatic
OAuth token refresh and a persistent push/streaming receiver are not implemented.
Graph-only APIs are outside EWS. Parsing, OCR and document editing use downstream nodes.
NTLM uses protocol-defined legacy digest primitives; FIPS-constrained environments may
need an authentication method allowed by their own policy.

The publication artifact is therefore labeled **0.2.0-rc.1**, not an unqualified stable
release. This boundary must remain visible in public documentation until the live gates
have been completed and recorded.
