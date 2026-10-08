#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { inspectPayment, ReceiptError } from './verify.mjs';
import { createRpc, verifyPayment } from './rpc.mjs';

const help = `Solana Receipt Kit — read-only SPL payment reconciliation

  inspect --invoice FILE --transaction FILE
    Inspect fixture/captured JSON. Never records a payment or establishes finality.
  verify --invoice FILE --signature BASE58 --rpc HTTPS_URL [--ledger FILE]
    Fetch finalized evidence from a trusted RPC. Optionally record atomically in SQLite.

Node 24+. No private keys, transaction signing, or fund transfers.
RPC URLs may contain credentials: prefer SOLANA_RPC_URL to --rpc.
Exit codes: 0 = matched, 1 = rejected/error, 2 = invalid invocation.
`;
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') { process.stdout.write(help); return; }
  const opts = {};
  const allowed = command === 'inspect' ? ['--invoice', '--transaction'] : command === 'verify' ? ['--invoice', '--signature', '--rpc', '--ledger'] : [];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || opts[args[i]]) throw new ReceiptError('USAGE', help);
    opts[args[i]] = args[i + 1];
  }
  if (!allowed.length || !opts['--invoice']) throw new ReceiptError('USAGE', help);
  const invoice = JSON.parse(await readFile(opts['--invoice'], 'utf8'));
  if (command === 'inspect') {
    if (!opts['--transaction']) throw new ReceiptError('USAGE', help);
    const tx = JSON.parse(await readFile(opts['--transaction'], 'utf8'));
    const receipt = inspectPayment(invoice, tx, tx.transaction?.signatures?.[0]);
    console.log(JSON.stringify({ status: 'fixture-match', warning: 'Untrusted local evidence; NOT a verified payment.', receipt }, null, 2));
    return;
  }
  const url = opts['--rpc'] ?? process.env.SOLANA_RPC_URL;
  if (!url || !opts['--signature']) throw new ReceiptError('USAGE', help);
  const receipt = await verifyPayment(invoice, opts['--signature'], createRpc(url));
  let output = { status: 'verified-not-recorded', receipt };
  if (opts['--ledger']) {
    const { ReceiptLedger } = await import('./ledger.mjs');
    const ledger = new ReceiptLedger(opts['--ledger']);
    try { output = ledger.record(receipt); } finally { ledger.close(); }
  }
  console.log(JSON.stringify(output, null, 2));
}
main().catch(error => {
  console.error(JSON.stringify({ status: 'rejected', code: error.code ?? 'INVALID_INPUT', message: error instanceof ReceiptError ? error.message : 'Invalid input or local storage failure.' }));
  process.exitCode = error.code === 'USAGE' ? 2 : 1;
});
