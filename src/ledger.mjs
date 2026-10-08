import { DatabaseSync } from 'node:sqlite';
import { ReceiptError } from './verify.mjs';

/** Keep this ledger on trusted local storage; do not accept receipts supplied by clients. */
export class ReceiptLedger {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS receipts (
        network TEXT NOT NULL, invoice_id TEXT NOT NULL, signature TEXT NOT NULL,
        invoice_hash TEXT NOT NULL, receipt TEXT NOT NULL,
        PRIMARY KEY (network, invoice_id), UNIQUE (network, signature)
      );`);
  }
  record(receipt) {
    if (receipt?.evidence !== 'rpc-finalized') throw new ReceiptError('UNVERIFIED_RECEIPT', 'Only receipts from trusted RPC verification may be recorded.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT * FROM receipts WHERE network = ? AND (invoice_id = ? OR signature = ?)')
        .all(receipt.genesisHash, receipt.invoiceId, receipt.signature);
      if (existing.length) {
        if (existing.length === 1 && existing[0].invoice_id === receipt.invoiceId && existing[0].signature === receipt.signature && existing[0].invoice_hash === receipt.invoiceHash) {
          this.db.exec('COMMIT');
          return { status: 'already-recorded', receipt: JSON.parse(existing[0].receipt) };
        }
        throw new ReceiptError('REPLAY_CONFLICT', 'Invoice or transaction has already been credited.');
      }
      this.db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?)').run(receipt.genesisHash, receipt.invoiceId, receipt.signature, receipt.invoiceHash, JSON.stringify(receipt));
      this.db.exec('COMMIT');
      return { status: 'recorded', receipt };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
