# Installation and release

## Build from source

Node.js 22/24, npm and OpenSSL are required for development tests. OpenSSL is used
only to generate synthetic TLS certificates in the test suite, not at runtime.

```sh
npm ci --ignore-scripts
npm run check
npm audit --omit=dev
npm run test:package
npm pack
```

Only `dist`, documentation, examples, license notices and npm metadata enter the
installable archive. Source tests, customer workflows, development dependencies and
credentials do not. Runtime dependencies are installed by npm; this is not an offline
bundle. Preserve `package-lock.json` in the source repository.

`test:package` packs the actual artifact, installs it in a fresh temporary directory,
loads every exported node and credential without another n8n SDK, and requires a clean
consumer production audit. The temporary installation is removed afterwards. Run
`npm audit` separately to inspect the known development-only upstream findings described
in `AUDIT.md`; a production-only audit intentionally does not cover that test environment.
To keep the exact tested archive, install-check report, consumer audit and CycloneDX
dependency inventory, use `npm run test:package -- /absolute/path/release-directory`.

## Persistent community package installation

Run as the n8n service user, in its persistent `.n8n/nodes` directory:

```sh
npm install --ignore-scripts /absolute/path/n8n-nodes-exchange-onprem-0.2.0-rc.1.tgz
```

Back up existing package metadata and n8n configuration first. Keep the archive in a
stable location if an installation references it using `file:`. Do not replace the
whole `.n8n/nodes` directory or its existing package manifest. Restart n8n after
checking running executions. Community package loading must be allowed by the instance.

The node types are:

- `n8n-nodes-exchange-onprem.exchangeOnPrem`
- `n8n-nodes-exchange-onprem.exchangeOnPremTrigger`
- `n8n-nodes-exchange-onprem.exchangeSendAndWait`

Examples use these type names. The credential type is `exchangeOnPrem`.

## Docker and queue mode

Install into the persistent n8n data volume as the n8n user, or build the package into
your existing pinned n8n image. Do not switch the base image to `latest` as part of
this installation. A volume mount can hide files installed into an image, so inspect
the actual mount layout. Every worker and the main instance need the same package
and dependencies. A task-runner container does not need this package solely to run
the native nodes; downstream Code nodes have their own runner configuration.

## Private custom-extension installation

Alternatively install the archive into a dedicated persistent directory, for example
`/opt/n8n-exchange`, then add its compiled directory to the existing custom paths:

```text
N8N_CUSTOM_EXTENSIONS=/opt/n8n-exchange/node_modules/n8n-nodes-exchange-onprem/dist
```

Preserve other custom directories using n8n's semicolon separator. Mount the entire
installation with its dependencies into the container. Use read-only mounts after
installation when appropriate. In this mode node types have the `CUSTOM.` prefix,
for example `CUSTOM.exchangeOnPrem`; replace the package prefix in example imports.
Do not install both modes simultaneously.

## Connect and verify

1. Create a new **Exchange On-Premises EWS** credential for a dedicated test mailbox.
2. Configure the EWS endpoint, schema version, account, mailbox and private CA if needed.
3. Keep capabilities off and run **Connection → Test**.
4. Read folders, one mail, an attachment and one calendar window. Check identities and paging.
5. Activate the change trigger in a disposable workflow; verify initial backfill behavior,
   a new item and restart persistence.
6. Enable only the capabilities needed for explicitly selected disposable test objects.
7. Run the live acceptance list in `AUDIT.md`, including Send and Wait through the real
   reverse proxy. Never use synthetic test-suite assertions as proof of server compatibility.

For an opt-in command-line read test, set environment variables securely without
putting a password in command history, then run `npm run test:live`. Required variables:
`EWS_LIVE_TEST=yes`, `EWS_ENDPOINT`, `EWS_MAILBOX`, `EWS_USER`, `EWS_PASSWORD`; optional
`EWS_DOMAIN`, `EWS_AUTH`, `EWS_ACCESS_TOKEN`, `EWS_CA_PEM`. The test only checks the
connection and reads one search result; output is limited to counts/status.

## Upgrade and rollback

Keep the previous package archive and lockfiles. Stop or pause affected workflows
before changing versions, then restart the main instance and workers consistently.
To roll back, reinstall the previous archive and restart. Preserve credentials and
workflow backups; EWS side effects cannot be undone by rolling back software.

## Publishing

No repository or registry publication is performed by the build scripts.

1. Choose the GitHub owner, repository URL and npm publisher. Package-name availability
   must be checked again at publication time.
2. Add the real `repository`, `bugs` and `homepage` fields to `package.json`; configure
   a security contact and GitHub private vulnerability reporting. Review the MIT license.
3. Run `npm ci --ignore-scripts`, `npm run check`, `npm audit --omit=dev`,
   `npm run test:package`, and `npm pack`. Review the full development dependency audit too.
4. Review `npm pack --dry-run`, inspect the archive, scan for secrets, and complete
   deployment-specific live acceptance tests.
5. Push this repository to the selected GitHub destination. GitHub Actions then runs
   the Node 22/24 checks. CI is prepared but has not run remotely until you push it.
6. Publish a tested candidate intentionally with `npm publish --tag next --access public`.
   Registry credentials belong in a trusted publisher configuration or local npm auth,
   never in source or example workflows. Do not make a registry token available to
   pull-request code.
7. Tag the source revision and attach the archive plus checksums to a GitHub release.
8. Promote to a stable version only after the live audit gates are recorded as passed.
