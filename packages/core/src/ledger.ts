/**
 * Coin ledger — domain logic for balance validation.
 *
 * Actual writes happen in a single serialisable transaction in the worker or web tier.
 * This module contains the pure business rules so they can be tested without a database.
 */

export type TransactionType =
  | "earn_call"
  | "earn_referral"
  | "earn_streak"
  | "spend_feature"
  | "spend_tip"
  | "admin_grant"
  | "admin_deduct"
  | "refund";

export interface LedgerEntry {
  type: TransactionType;
  amount: number; // positive = credit, negative = debit
  balanceAfter: number;
  description: string;
  idempotencyKey: string;
}

export type LedgerResult =
  | { ok: true; entry: Omit<LedgerEntry, "balanceAfter"> }
  | { ok: false; reason: "insufficient_balance" | "amount_out_of_range" | "duplicate_key" };

/**
 * Validate a proposed ledger entry against business rules.
 * Does not perform any I/O.
 */
export function validateLedgerEntry(opts: {
  currentBalance: number;
  type: TransactionType;
  amount: number;
  idempotencyKey: string;
  description: string;
}): LedgerResult {
  const MAX_SINGLE_CREDIT = 10_000;
  const MAX_SINGLE_DEBIT = -10_000;

  if (opts.amount === 0) {
    return { ok: false, reason: "amount_out_of_range" };
  }
  if (opts.amount > MAX_SINGLE_CREDIT || opts.amount < MAX_SINGLE_DEBIT) {
    return { ok: false, reason: "amount_out_of_range" };
  }
  if (opts.amount < 0 && opts.currentBalance + opts.amount < 0) {
    return { ok: false, reason: "insufficient_balance" };
  }
  if (!opts.idempotencyKey.trim()) {
    return { ok: false, reason: "duplicate_key" };
  }

  return {
    ok: true,
    entry: {
      type: opts.type,
      amount: opts.amount,
      description: opts.description,
      idempotencyKey: opts.idempotencyKey,
    },
  };
}

/** Compute the balance after applying a sequence of amounts to an initial balance. */
export function computeBalance(initial: number, amounts: number[]): number {
  return amounts.reduce((acc, amt) => acc + amt, initial);
}
