import { createHash } from 'node:crypto';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export class ReceiptError extends Error {
  constructor(code, message) { super(message); this.name = 'ReceiptError'; this.code = code; }
}
function requireThat(condition, code, message) {
  if (!condition) throw new ReceiptError(code, message);
}
export function isBase58(value, bytes) {
  if (typeof value !== 'string' || value.length > bytes * 2) return false;
  let n = 0n;
  for (const char of value) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return false;
    n = n * 58n + BigInt(digit);
  }
  let length = 0;
  while (n > 0n) { length++; n >>= 8n; }
  return length + (value.match(/^1*/)?.[0].length ?? 0) === bytes;
}
function integerString(value) { return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value); }
function units(value) {
  requireThat(integerString(value) && value.length <= 20, 'INVALID_AMOUNT', 'Amounts must be unsigned integer strings.');
  const n = BigInt(value);
  requireThat(n <= 18446744073709551615n, 'INVALID_AMOUNT', 'Amount exceeds SPL u64 range.');
  return n;
}
export function normalizeInvoice(input) {
  requireThat(input && typeof input === 'object', 'INVALID_INVOICE', 'Invoice must be an object.');
  const { id, genesisHash, mint, recipientTokenAccount, recipientOwner, reference, amount, decimals, notBefore, expiresAt } = input;
  requireThat(typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id), 'INVALID_INVOICE', 'Use a stable invoice ID (letters, digits, hyphens, underscores).');
  for (const [key, value] of Object.entries({ genesisHash, mint, recipientTokenAccount, recipientOwner, reference })) {
    requireThat(isBase58(value, 32), 'INVALID_INVOICE', `${key} must encode exactly 32 bytes in base58.`);
  }
  requireThat(units(amount) > 0n, 'INVALID_INVOICE', 'Invoice amount must be positive.');
  requireThat(Number.isInteger(decimals) && decimals >= 0 && decimals <= 255, 'INVALID_INVOICE', 'Invalid token decimals.');
  requireThat(Number.isSafeInteger(notBefore) && notBefore >= 0 && Number.isSafeInteger(expiresAt) && expiresAt >= notBefore,
    'INVALID_INVOICE', 'Invoice requires an inclusive Unix-seconds payment window.');
  return { id, genesisHash, mint, recipientTokenAccount, recipientOwner, reference, amount, decimals, notBefore, expiresAt };
}
export function invoiceHash(invoice) {
  return createHash('sha256').update(JSON.stringify(normalizeInvoice(invoice))).digest('hex');
}

/** Inspects evidence only. An arbitrary JSON file does NOT prove finality or authenticity. */
export function inspectPayment(input, tx, signature) {
  const invoice = normalizeInvoice(input);
  requireThat(isBase58(signature, 64), 'INVALID_SIGNATURE', 'Signature must encode 64 bytes.');
  requireThat(tx !== null && tx !== undefined, 'NOT_FOUND', 'Transaction not found at the requested commitment.');
  requireThat(tx.meta && tx.meta.err === null, 'FAILED_TRANSACTION', 'Transaction failed or execution metadata is unavailable.');
  requireThat(tx.version === undefined || tx.version === 'legacy' || tx.version === 0, 'UNSUPPORTED_VERSION', 'Unsupported transaction version.');
  requireThat(Number.isSafeInteger(tx.slot) && tx.slot >= 0, 'INVALID_EVIDENCE', 'Missing valid transaction slot.');
  requireThat(Number.isSafeInteger(tx.blockTime), 'MISSING_TIME', 'Block time unavailable; cannot enforce payment window.');
  requireThat(tx.blockTime >= invoice.notBefore && tx.blockTime <= invoice.expiresAt, 'OUTSIDE_WINDOW', 'Payment is outside the invoice window.');
  requireThat(tx.transaction?.signatures?.[0] === signature, 'SIGNATURE_MISMATCH', 'RPC returned a different transaction.');
  const message = tx.transaction.message;
  requireThat(Array.isArray(message?.accountKeys) && Array.isArray(message?.instructions), 'INVALID_EVIDENCE', 'Expected jsonParsed transaction.');
  const keys = message.accountKeys;
  requireThat(keys.every(k => k && isBase58(k.pubkey, 32) && typeof k.signer === 'boolean' && typeof k.writable === 'boolean'), 'INVALID_EVIDENCE', 'Malformed parsed account keys.');
  requireThat(new Set(keys.map(k => k.pubkey)).size === keys.length, 'INVALID_EVIDENCE', 'Duplicate account keys.');
  const ref = keys.find(k => k.pubkey === invoice.reference);
  requireThat(ref && !ref.signer && !ref.writable, 'REFERENCE_MISMATCH', 'Invoice reference must be present as a readonly non-signer.');
  const index = keys.findIndex(k => k.pubkey === invoice.recipientTokenAccount);
  requireThat(index >= 0 && keys[index].writable, 'RECIPIENT_MISMATCH', 'Recipient token account is not writable in this transaction.');

  const all = [...message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap(group => group.instructions ?? [])];
  const outgoing = all.filter(ix => ix?.parsed?.info?.source === invoice.recipientTokenAccount);
  requireThat(outgoing.length === 0, 'AMBIGUOUS_TRANSFER', 'Recipient has an outgoing instruction in the same transaction.');
  const transfers = all.filter(ix => ix?.parsed?.info?.destination === invoice.recipientTokenAccount);
  requireThat(transfers.length === 1, 'AMBIGUOUS_TRANSFER', 'Require exactly one transfer into the recipient token account.');
  const ix = transfers[0];
  requireThat(message.instructions.includes(ix), 'UNSUPPORTED_TRANSFER', 'CPI payments are not supported in this prototype.');
  requireThat(ix.programId === TOKEN_PROGRAM && ix.parsed?.type === 'transferChecked', 'UNSUPPORTED_TRANSFER', 'Only original SPL Token transferChecked payments are supported.');
  const info = ix.parsed.info;
  requireThat(info.mint === invoice.mint, 'MINT_MISMATCH', 'Transfer mint differs from invoice.');
  requireThat(info.source !== info.destination && isBase58(info.source, 32), 'INVALID_EVIDENCE', 'Invalid source token account.');
  requireThat(keys.some(k => k.pubkey === info.authority && k.signer), 'UNSUPPORTED_AUTHORITY', 'Require a direct signing transfer authority.');
  requireThat(info.tokenAmount?.decimals === invoice.decimals && units(info.tokenAmount?.amount) === units(invoice.amount), 'AMOUNT_MISMATCH', 'Transfer amount or decimals differ from invoice.');

  function balance(list, required) {
    requireThat(Array.isArray(list), 'MISSING_BALANCE', 'Token balance metadata is required.');
    const entries = list.filter(b => b.accountIndex === index);
    requireThat(entries.length <= 1, 'INVALID_EVIDENCE', 'Duplicate token balance records.');
    if (entries.length === 0) {
      requireThat(!required, 'MISSING_BALANCE', 'Recipient post-balance is missing.');
      return 0n;
    }
    const entry = entries[0];
    requireThat(entry.mint === invoice.mint && entry.owner === invoice.recipientOwner && entry.programId === TOKEN_PROGRAM,
      'BALANCE_IDENTITY_MISMATCH', 'Token balance mint, owner, or program differs from invoice.');
    requireThat(entry.uiTokenAmount?.decimals === invoice.decimals, 'AMOUNT_MISMATCH', 'Balance decimals differ from invoice.');
    return units(entry.uiTokenAmount?.amount);
  }
  const pre = balance(tx.meta.preTokenBalances, false);
  if (!tx.meta.preTokenBalances.some(b => b.accountIndex === index)) {
    requireThat(Array.isArray(tx.meta.preBalances) && tx.meta.preBalances[index] === 0, 'MISSING_BALANCE', 'Missing pre-token balance is only allowed for a newly created account.');
  }
  const delta = balance(tx.meta.postTokenBalances, true) - pre;
  requireThat(delta === units(invoice.amount), 'NET_AMOUNT_MISMATCH', 'Recipient net token increase differs from invoice.');
  return { invoiceId: invoice.id, invoiceHash: invoiceHash(invoice), signature, genesisHash: invoice.genesisHash,
    slot: tx.slot, blockTime: tx.blockTime, mint: invoice.mint, amount: invoice.amount, decimals: invoice.decimals,
    recipientTokenAccount: invoice.recipientTokenAccount, recipientOwner: invoice.recipientOwner,
    reference: invoice.reference, authority: info.authority };
}
