# Secret analysis architecture (2.2.3)

DotEnvy performs local pattern/entropy analysis by default. Cloud analysis is
explicitly opt-in. A registered device uses a per-installation HMAC credential
held in VS Code SecretStorage. Requests send candidates and sanitized context
transiently to DotAegis. The server classifies 35 numeric feature tokens with a
small NumPy transformer; it is not a general-purpose language model.

Detection captures features from the original value and redacts display/context
before exposing scan results to the webview. A source location and digest let
Move to .env re-read and verify the current original value. Plaintext keys are
not held in persistent feedback or passed through webview messages.

Feedback schema 2 sends an ID, 35 finite features, feature schema, action and
consistent label only. Local storage purges older context-bearing feedback.
Uploads are serialized, preserve concurrent additions, and require explicit
server acknowledgment. Aegis stages observations with quotas and deduplication;
only administrator-approved observations update its durable checkpoint.

Aegis bundles a synthetic bootstrap, verifies readiness against the trained model
and PostgreSQL, persists numeric replay and optimizer state, and uses model
weight revisions in Redis/LRU cache keys. Redis outages fall back to bounded LRU.
Full-value SHA-256 community hashes live in v2 tables and require administrator
review with matching real evidence. Hashes alone cannot be verified by a model.

See each repository's README and regression suites for operating instructions.
