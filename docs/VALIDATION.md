# Validation evidence

Local Node.js 24.10.0 run: 36 automated tests passed. Fixtures are synthetic, including the successful example. Mock RPC tests confirm genesis-hash checks and finalized transaction request parameters, not a real provider's correctness.

Read-only public devnet connectivity check on 2026-10-09 (India time): `getGenesisHash` returned `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; finalized `getSlot` returned 508921297. This demonstrates RPC reachability only. No actual payment was sent, no wallet key was used, and no successful real-payment acceptance test has been completed.

Tests cover failed/missing execution metadata, payment windows, reference/signature/recipient/mint mismatches, under/overpayment, decimals, numeric precision, unsupported programs and transfer types, authority checks, post-balance ownership, net changes, missing or duplicate balances, multiple transfers and CPI paths, idempotent retries, invoice/signature conflicts, malformed HTTP/JSON-RPC, and CLI error handling.

Not yet validated: real payment fixtures, multi-process contention/crash recovery, independent security review, large-scale RPC behaviour, Token-2022, fulfilment atomicity, and production adoption. These are proposed future work, not accomplishments.
