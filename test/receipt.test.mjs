import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectPayment, invoiceHash, normalizeInvoice } from '../src/verify.mjs';
import { createRpc, verifyPayment } from '../src/rpc.mjs';
import { ReceiptLedger } from '../src/ledger.mjs';
const invoice = JSON.parse(readFileSync(new URL('../examples/invoice.json', import.meta.url)));
const fixture = JSON.parse(readFileSync(new URL('../examples/transaction.json', import.meta.url)));
const signature = fixture.transaction.signatures[0];
const clone = value => structuredClone(value);
const code = wanted => error => error.code === wanted;

test('exact direct payment reconciles integer units', () => {
  const result = inspectPayment(invoice, fixture, signature);
  assert.equal(result.amount, '25000000');
  assert.equal(result.evidence, undefined);
});
const cases = [
  ['failed transaction', tx => { tx.meta.err = { InstructionError: [0, 'Custom'] }; }, 'FAILED_TRANSACTION'],
  ['missing execution status', tx => { delete tx.meta.err; }, 'FAILED_TRANSACTION'],
  ['missing block time', tx => { tx.blockTime = null; }, 'MISSING_TIME'],
  ['late payment', tx => { tx.blockTime = invoice.expiresAt + 1; }, 'OUTSIDE_WINDOW'],
  ['early payment', tx => { tx.blockTime = invoice.notBefore - 1; }, 'OUTSIDE_WINDOW'],
  ['signature substitution', tx => { tx.transaction.signatures[0] = '1'.repeat(64); }, 'SIGNATURE_MISMATCH'],
  ['missing reference', tx => { tx.transaction.message.accountKeys[3].pubkey = '1'.repeat(32); }, 'REFERENCE_MISMATCH'],
  ['writable reference', tx => { tx.transaction.message.accountKeys[3].writable = true; }, 'REFERENCE_MISMATCH'],
  ['wrong recipient', tx => { tx.transaction.message.instructions[0].parsed.info.destination = '1'.repeat(32); }, 'AMBIGUOUS_TRANSFER'],
  ['wrong mint', tx => { tx.transaction.message.instructions[0].parsed.info.mint = '1'.repeat(32); }, 'MINT_MISMATCH'],
  ['underpayment', tx => { tx.transaction.message.instructions[0].parsed.info.tokenAmount.amount = '24999999'; }, 'AMOUNT_MISMATCH'],
  ['overpayment', tx => { tx.transaction.message.instructions[0].parsed.info.tokenAmount.amount = '25000001'; }, 'AMOUNT_MISMATCH'],
  ['numeric amount', tx => { tx.transaction.message.instructions[0].parsed.info.tokenAmount.amount = 25000000; }, 'INVALID_AMOUNT'],
  ['incorrect decimals', tx => { tx.transaction.message.instructions[0].parsed.info.tokenAmount.decimals = 9; }, 'AMOUNT_MISMATCH'],
  ['different token program', tx => { tx.transaction.message.instructions[0].programId = '1'.repeat(32); }, 'UNSUPPORTED_TRANSFER'],
  ['unchecked transfer', tx => { tx.transaction.message.instructions[0].parsed.type = 'transfer'; }, 'UNSUPPORTED_TRANSFER'],
  ['non-signing authority', tx => { tx.transaction.message.accountKeys[0].signer = false; }, 'UNSUPPORTED_AUTHORITY'],
  ['wrong post-balance owner', tx => { tx.meta.postTokenBalances[0].owner = '1'.repeat(32); }, 'BALANCE_IDENTITY_MISMATCH'],
  ['wrong net change', tx => { tx.meta.postTokenBalances[0].uiTokenAmount.amount = '25000000'; }, 'NET_AMOUNT_MISMATCH'],
  ['missing post balance', tx => { tx.meta.postTokenBalances = []; }, 'MISSING_BALANCE'],
  ['missing pre balance on existing account', tx => { tx.meta.preTokenBalances = []; }, 'MISSING_BALANCE'],
  ['duplicate post balance', tx => { tx.meta.postTokenBalances.push(clone(tx.meta.postTokenBalances[0])); }, 'INVALID_EVIDENCE'],
  ['multiple transfers', tx => { tx.transaction.message.instructions.push(clone(tx.transaction.message.instructions[0])); }, 'AMBIGUOUS_TRANSFER'],
  ['CPI transfer', tx => { tx.meta.innerInstructions = [{ index: 0, instructions: [tx.transaction.message.instructions.pop()] }]; }, 'UNSUPPORTED_TRANSFER'],
  ['recipient outgoing payment', tx => { tx.meta.innerInstructions = [{ index: 0, instructions: [{ parsed: { info: { source: invoice.recipientTokenAccount } } }] }]; }, 'AMBIGUOUS_TRANSFER'],
];
for (const [name, mutate, expected] of cases) test(`rejects ${name}`, () => {
  const tx = clone(fixture); mutate(tx);
  assert.throws(() => inspectPayment(invoice, tx, signature), code(expected));
});
test('new token account may have no pre-token record when pre-lamports are zero', () => {
  const tx = clone(fixture); tx.meta.preTokenBalances = []; tx.meta.preBalances[2] = 0;
  tx.meta.postTokenBalances[0].uiTokenAmount.amount = invoice.amount;
  assert.equal(inspectPayment(invoice, tx, signature).amount, invoice.amount);
});
test('uses exact bigint amounts above JavaScript safe integer', () => {
  const huge = '9007199254740993'; const tx = clone(fixture);
  tx.transaction.message.instructions[0].parsed.info.tokenAmount.amount = huge;
  tx.meta.preTokenBalances[0].uiTokenAmount.amount = '0';
  tx.meta.postTokenBalances[0].uiTokenAmount.amount = huge;
  assert.equal(inspectPayment({ ...invoice, amount: huge }, tx, signature).amount, huge);
});
test('rejects malformed invoice and u64 overflow', () => {
  for (const amount of ['-1', '0', '1.5', '01', '18446744073709551616', 25]) assert.throws(() => normalizeInvoice({ ...invoice, amount }));
  assert.throws(() => normalizeInvoice({ ...invoice, mint: 'not-an-address' }));
  assert.throws(() => normalizeInvoice({ ...invoice, expiresAt: 0 }));
});
test('invoice hash ignores property order but binds every accepted field', () => {
  assert.equal(invoiceHash(invoice), invoiceHash(Object.fromEntries(Object.entries(invoice).reverse())));
  assert.notEqual(invoiceHash(invoice), invoiceHash({ ...invoice, amount: '1' }));
});
test('RPC path pins network and asks for finalized parsed evidence', async () => {
  const calls = [];
  const receipt = await verifyPayment(invoice, signature, async (method, params) => {
    calls.push([method, params]); return method === 'getGenesisHash' ? invoice.genesisHash : fixture;
  });
  assert.equal(receipt.evidence, 'rpc-finalized');
  assert.deepEqual(calls[1], ['getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]]);
});
test('wrong network never proceeds to transaction lookup', async () => {
  let calls = 0;
  await assert.rejects(verifyPayment(invoice, signature, async () => { calls++; return 'wrong'; }), code('NETWORK_MISMATCH'));
  assert.equal(calls, 1);
});
test('null finalized RPC transaction fails closed', async () => {
  await assert.rejects(verifyPayment(invoice, signature, async m => m === 'getGenesisHash' ? invoice.genesisHash : null), code('NOT_FOUND'));
});
test('RPC transport handles HTTP, invalid JSON, errors, and mismatched IDs', async () => {
  const results = [
    [{ ok: false, status: 429 }, 'RPC_HTTP_ERROR'],
    [{ ok: true, json: async () => { throw Error(); } }, 'RPC_INVALID_RESPONSE'],
    [{ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -1 } }) }, 'RPC_INVALID_RESPONSE'],
    [{ ok: true, json: async () => ({ jsonrpc: '2.0', id: 2, result: null }) }, 'RPC_INVALID_RESPONSE']
  ];
  for (const [response, expected] of results) {
    const rpc = createRpc('https://example.invalid', { fetchImpl: async () => response });
    await assert.rejects(rpc('getTransaction'), code(expected));
  }
  assert.throws(() => createRpc('http://example.com'), code('INVALID_RPC'));
});
test('SQLite makes repeat calls idempotent and rejects reuse across invoices', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'receipt-kit-'));
  const path = join(dir, 'ledger.sqlite');
  const first = new ReceiptLedger(path); const second = new ReceiptLedger(path);
  const receipt = await verifyPayment(invoice, signature, async m => m === 'getGenesisHash' ? invoice.genesisHash : fixture);
  try {
    assert.equal(first.record(receipt).status, 'recorded');
    assert.equal(second.record(receipt).status, 'already-recorded');
    assert.throws(() => second.record({ ...receipt, invoiceId: 'another_invoice' }), code('REPLAY_CONFLICT'));
    assert.throws(() => first.record({ ...receipt, signature: '1'.repeat(64) }), code('REPLAY_CONFLICT'));
    assert.throws(() => first.record({ ...receipt, invoiceHash: 'changed' }), code('REPLAY_CONFLICT'));
    assert.throws(() => first.record({ ...receipt, evidence: undefined }), code('UNVERIFIED_RECEIPT'));
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true }); }
});
test('CLI fixtures are explicitly unverified and unknown flags fail', () => {
  const cwd = new URL('..', import.meta.url);
  const demo = spawnSync(process.execPath, ['src/cli.mjs', 'inspect', '--invoice', 'examples/invoice.json', '--transaction', 'examples/transaction.json'], { cwd, encoding: 'utf8' });
  assert.equal(demo.status, 0, demo.stderr);
  assert.equal(JSON.parse(demo.stdout).status, 'fixture-match');
  const bad = spawnSync(process.execPath, ['src/cli.mjs', 'inspect', '--ledger', 'x'], { cwd, encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
