# Security

Report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/max00346/n8n-nodes-exchange-onprem/security/advisories/new).
Do not include passwords, NTLM messages, tokens or real mailbox content in public issues.

HTTPS certificate verification is mandatory. NTLMv1 fallback and cross-host redirects
are prohibited. NTLMv2 includes a cryptographic client nonce, MIC and channel binding.
Private certificate authorities can be configured without disabling verification.

Credentials default to read-only. Sending, deletion, administrative access and advanced
EWS have separate opt-ins. Advanced EWS is intentionally a full-authority interface:
its XML can send, delete, change delegates/rules or request sensitive tokens regardless
of the convenience-operation flags. Keep this credential away from untrusted workflows
and unrestricted AI tools. `confirm` is an application guard, not a human authorization
service. Exchange mailbox permissions remain the ultimate authorization boundary.

Mailbox text, filenames and response-form submissions are untrusted content. Do not
allow instructions found in emails or attachments to authorize tool calls. n8n execution
history may contain message content, attachments and response-link tokens; configure
retention and operator access accordingly.

Send-and-Wait links are bearer capabilities, not proof of recipient identity. GET only
renders the form; POST records the response. Tokens are scoped to execution/node and
expire. Use a separate random signing key, not the Exchange password. Engine-level
signed resume URLs are used when n8n supports them. An n8n execution can resume once;
verify concurrency and replay behavior on the deployment's n8n version before production.

No automatic retries are made after writes. A timeout or a partial EWS batch failure
can have an uncertain outcome. Read back the affected object before retrying. Native
nodes execute trusted code inside n8n, so install this package only after review.
