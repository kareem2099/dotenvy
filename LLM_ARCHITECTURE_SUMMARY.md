# Local classification and shared learning — DotEnvy 2.2.4

Complete candidate -> 35 locally extracted features -> local transformer worker
-> classification. Raw candidates/code never enter the Aegis networking client.
The exact TypeScript forward pass matches Python probabilities within 1e-8 on
release fixtures. Bundled synthetic inference weights always provide an offline
fallback; failed inference uses local heuristics without a cloud fallback.

User decision -> immediate scoped local override -> one-time post-action consent.
Consent accepts this correction and future ones; refusal/dismissal is persisted.
Explicit Settings opt-out suppresses the suggestion; the toggle command allows
users to change their choice later. Earlier history is never backfilled.
With explicit community opt-in,
a separate numeric sample (random ID, schema 2, 35 finite numbers, label/action)
is queued and sent to `/extension/feedback` using per-installation HMAC.
Acknowledged batches are removed; stable IDs make retries idempotent. Local
fingerprints, paths, names, hashes and raw context never enter wire objects.

Pending server samples -> administrator review -> exact-gradient shared training
-> durable checkpoint -> `/model/release`. This public read endpoint returns
compressed inference weights, manifest and revision, never replay/optimizer.
No device credential is used for downloads. The client checks startup/hourly,
validates data, replaces its worker only when ready, and invalidates scan caches.
Bad updates retain the working local classifier. Both model downloads and numeric
feedback can be disabled; the deprecated raw-cloud flag has no effect.

Local override state and opt-in numeric queues each retain at most 500 entries.
Service credentials remain in SecretStorage. One accepted download is retained
in global storage alongside bundled weights. Numeric feedback and shared training
records persist server-side; no zero-storage or guaranteed anonymity claim applies.
The classifier detects resemblance to secrets, not credential validity.

See [README](README.md#privacy-local-ai-local-corrections-and-the-role-of-dotaegis)
for settings, precise data flows, consent and Arabic explanation.
