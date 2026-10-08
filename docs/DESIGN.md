# Design

An application creates a trusted invoice with a unique reference key. The customer pays separately. The application passes a signature to the RPC verifier; it is never used as proof on its own.

The RPC adapter verifies the genesis hash, requests `jsonParsed` transaction data at finalized commitment, and supplies the evidence to the pure verifier. The verifier validates execution, signature, time, accounts, instruction, and raw token deltas. It returns a receipt only when every supported check succeeds.

The optional SQLite ledger inserts the receipt in a `BEGIN IMMEDIATE` transaction. Unique constraints cover `(network, invoice_id)` and `(network, signature)`. A repeated exact request returns the original receipt. A reused transaction, changed invoice, or second payment for an existing invoice is rejected for manual reconciliation.

Invoice hashes use SHA-256 over a fixed field order. This binds idempotent retries to the complete accepted invoice content; it is not a digital signature. Raw amounts remain decimal integer strings. The local inspection command has no ledger-write option and labels its result unverified.

## Trust boundary

The invoice configuration, RPC provider, host filesystem, process, and server-side application are trusted. Browser-supplied RPC responses, receipts, and invoice overrides are untrusted and must not be passed to the recording interface. The prototype does not run a validator or a light client. RPC errors never become successful receipts. Error messages omit RPC URLs to avoid exposing embedded credentials.

## Planned hardening

Reference reuse checks at invoice creation, durable invoice lifecycle and a transactional fulfilment outbox, external security review, real devnet fixtures with provenance, typed public interfaces, explicit Token-2022 extension policy, database migrations, and a PostgreSQL adapter. Unsupported payments remain rejected until their semantics and tests are implemented.

## Evaluation

External integrations should compare integration time and failure behaviour against their existing Solana Pay/custom webhook flow. Adoption is currently zero. No claim is made that this toolkit will prevent every payment-processing error or that prospective partners have agreed to use it.
