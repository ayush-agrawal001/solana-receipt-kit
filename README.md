# Solana Receipt Kit

A small, read-only library and CLI for matching **original SPL Token `transferChecked` payments** to invoices and recording receipts without crediting the same transaction twice.

**Status: pre-release prototype, not audited or production-ready.** The included fixtures are synthetic. No customers, revenue, or successful real-payment pilot is claimed.

## Try it

Node.js 24 or newer; no npm dependencies or installation required.

```sh
npm test
npm run demo
node src/cli.mjs --help
```

The demo returns `fixture-match` and explicitly says it is not a verified payment. Its fake addresses, genesis hash, and signature must never be used as real invoice details.

## Verify a real invoice

Create an invoice JSON using the schema in `examples/invoice.json`. Use your actual mint, token account, owner, a unique read-only invoice reference, exact base-unit amount as a **string**, mint decimals, inclusive Unix-seconds payment window, and the expected network's genesis hash obtained independently from a trusted source.

```sh
export SOLANA_RPC_URL='https://YOUR_TRUSTED_RPC'
node src/cli.mjs verify --invoice invoice.json --signature SIGNATURE --ledger receipts.sqlite
```

Only `getGenesisHash` and finalized `getTransaction` reads are performed. The tool never requests a seed phrase, signs transactions, transfers money, or makes payments. It trusts the configured RPC provider's evidence; it does not independently verify consensus or signatures.

Possible outcomes:

| Result | Meaning |
| --- | --- |
| `recorded` | Matching finalized RPC evidence was recorded atomically in this local ledger |
| `already-recorded` | Same invoice, signature, and invoice content; safe retry with no second insertion |
| `verified-not-recorded` | Evidence matches, but no ledger was supplied; no replay protection across calls |
| `fixture-match` | Local JSON matches rules; authenticity and finality are not established |
| `rejected` | Invalid, unsupported, unavailable, mismatched, or replayed evidence; no new receipt |

Keep one authoritative ledger per application. Independent database files cannot prevent replay across applications. Receipt insertion is not an atomic business-fulfilment operation: use an outbox/idempotent delivery process in your own system. Do not fulfil an order merely because a prior receipt exists without checking your delivery state.

## Checks

Network genesis hash, requested signature, successful execution, payment window, read-only reference, recipient token-account address and owner, exact mint and decimals, checked-transfer instruction and signing authority, and net token-balance increase. Amounts use `BigInt`, never floating-point token values. SQLite uniqueness constraints protect invoice IDs and transaction signatures within a network.

## Deliberate scope

- Direct top-level transfers through the original SPL Token program only.
- Rejects Token-2022, unchecked transfers, CPI-only payments, multisig/non-signing authorities, multiple incoming transfers, same-transaction recipient outflows, missing metadata, and partial/overpayments.
- A newly created destination account may have no pre-token balance only when its pre-transaction lamport balance is zero.
- This tool verifies matching payment evidence, not invoice legitimacy, payer identity, legal compliance, token value, or business fulfilment.
- Invoice fields and ledger inputs must be supplied by trusted application code. A client can forge local JSON or a JavaScript receipt object; those are not trust boundaries.
- Node's built-in SQLite API is experimental in Node 24.10.0. Pin and test the runtime before deployment.

## Library use

```js
import { createRpc, verifyPayment } from './src/rpc.mjs';
import { ReceiptLedger } from './src/ledger.mjs';

const receipt = await verifyPayment(invoice, signature, createRpc(process.env.SOLANA_RPC_URL));
const ledger = new ReceiptLedger('receipts.sqlite');
try { console.log(ledger.record(receipt)); }
finally { ledger.close(); }
```

## Why another toolkit?

Solana Pay already defines reference-based payments and offers transfer validation. This project is a focused experiment in application reconciliation: strict invoice matching, machine-readable rejection reasons, adversarial fixtures, and a persistent idempotent ledger. It does not replace Solana Pay or claim novel on-chain infrastructure. Whether developers need this packaging still needs validation through external integrations.

## Validation and roadmap

Run `npm test` for verifier edge cases, mocked RPC contract tests, SQLite duplicate protection, and CLI behaviour. See [validation](docs/VALIDATION.md) for the exact evidence and limitations, and [design](docs/DESIGN.md) for the architecture. The planned grant work adds independent review, real devnet acceptance tests, a production persistence adapter, typed interfaces, and documented external pilots. These features are not already shipped.

Original implementation prepared with AI coding assistance and automated tests. Human review and live end-to-end testing are still required before production use.

## References

- [Solana getTransaction](https://solana.com/docs/rpc/http/gettransaction)
- [Solana RPC JSON structures](https://solana.com/docs/rpc/json-structures)
- [Solana Pay](https://github.com/solana-labs/solana-pay)

MIT licensed. Security reports: see [SECURITY.md](SECURITY.md).
