# Revert purchase from Buying cashflow

Administrators can open Cash movement and choose **Revert purchase** for a buying transaction. A reason and explicit confirmation are required. This cancels the entire transaction on its original cashflow date, removes its inventory items, and credits only its Cash portion to the current Manila business day (4 AM rollover). Non-cash payments do not increase cash on hand.

Items linked to pools, splits, liquidation, refining, or retail sales cannot be cancelled until their downstream operations are reversed. The server validates this against the current ledger, rather than trusting the visible client state.

## Audit and balances

Original purchase rows are archived in a `settings` record keyed by transaction and original cashflow day. They are removed from active inventory and active purchase totals. Cashflow history continues to display them as **Reverted**. The archive contains the original items, total payout, Cash amount returned, cancellation reason, administrator, and timestamp.

Cashflow balance calculations retain the original cash debits from the archive and apply an explicit `revert` credit. This avoids double refunds when the purchase predates the latest balance set, a movement-counter reset, or a carried-forward opening balance. IN includes reversal credits; OUT retains the original cash movement as an audit trail. A historical cancellation credits today's cash; it does not rewrite a previously reconciled day's cash balance.

If there is no current or previous configured cash balance, a Cash cancellation requires setting cash on hand first. Reversal of non-cash purchases is still possible.

## Atomicity

The inventory removal, audit creation, cashflow update, and ledger revision increment run in one SQLite/libSQL write batch. Guards compare both the expected ledger revision and original cashflow settings value. A conflicting edit aborts the transaction. The unique audit key prevents repeat cancellation. Ordinary cash adjustments also compare their original cashflow value before writing, so a stale adjustment cannot overwrite a reversal.

Tests cover isolated HTTP authentication, admin-only authorization, actual SQLite rollback, repeated requests, cash and non-cash purchases, latest-set baselines, movement resets, historical carry-over, later purchases, and downstream inventory links. They use synthetic data in temporary databases and do not change production records.
