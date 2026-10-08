import { inspectPayment, normalizeInvoice, isBase58, ReceiptError } from './verify.mjs';

export function createRpc(url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) {
    throw new ReceiptError('INVALID_RPC', 'Use HTTPS or a loopback HTTP RPC endpoint.');
  }
  let sequence = 0;
  return async (method, params = []) => {
    const id = ++sequence;
    let response;
    try {
      response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw new ReceiptError('RPC_UNAVAILABLE', 'RPC request failed or timed out.'); }
    if (!response.ok) throw new ReceiptError('RPC_HTTP_ERROR', `RPC returned HTTP ${response.status}.`);
    let payload;
    try { payload = await response.json(); } catch { throw new ReceiptError('RPC_INVALID_RESPONSE', 'RPC returned invalid JSON.'); }
    if (payload?.jsonrpc !== '2.0' || payload.id !== id || !Object.hasOwn(payload, 'result') || payload.error) {
      throw new ReceiptError('RPC_INVALID_RESPONSE', 'RPC error or mismatched response envelope.');
    }
    return payload.result;
  };
}

/** Finality is trusted to the supplied RPC provider; this is not a light client. */
export async function verifyPayment(invoiceInput, signature, rpc) {
  const invoice = normalizeInvoice(invoiceInput);
  if (!isBase58(signature, 64)) throw new ReceiptError('INVALID_SIGNATURE', 'Signature must encode 64 bytes.');
  const genesis = await rpc('getGenesisHash');
  if (genesis !== invoice.genesisHash) throw new ReceiptError('NETWORK_MISMATCH', 'RPC network differs from invoice.');
  const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
  return { ...inspectPayment(invoice, tx, signature), evidence: 'rpc-finalized', verifiedAt: new Date().toISOString() };
}
