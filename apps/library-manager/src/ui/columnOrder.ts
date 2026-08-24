// Where the columns sit, left to right.
//
// Kept apart from the catalogue in columns.tsx, and free of any reference to
// Spicetify, so the ordering rules can be tested under Node.
//
// The stored order covers every known column, hidden ones included: hiding a
// column and showing it again should put it back where it was, not at the end.

import { COLUMNS, type ColKey } from './columns';

const ORDER_KEY = 'iceni:library-manager:columns-order';

const catalogue = () => COLUMNS.map((c) => c.key);

/**
 * The stored order, reconciled with the catalogue.
 *
 * Keys that no longer exist are dropped -- one would otherwise leave a grid
 * track with no header and no cells, shifting everything after it. Columns
 * added since the order was saved are appended, so a new one is visible rather
 * than silently absent.
 */
export function reconcile(stored: unknown): ColKey[] {
  const known = catalogue();
  const seen = new Set<ColKey>();
  const out: ColKey[] = [];
  if (Array.isArray(stored)) {
    for (const key of stored) {
      if (known.includes(key as ColKey) && !seen.has(key as ColKey)) {
        seen.add(key as ColKey);
        out.push(key as ColKey);
      }
    }
  }
  for (const key of known) if (!seen.has(key)) out.push(key);
  return out;
}

export function loadOrder(): ColKey[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    return reconcile(raw ? JSON.parse(raw) : null);
  } catch {
    return catalogue();
  }
}

export function clearOrder(): void {
  try {
    localStorage.removeItem(ORDER_KEY);
  } catch { /* as below */ }
}

export function saveOrder(order: ColKey[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch { /* a lost column order is not worth surfacing */ }
}

/**
 * Moves `key` so it lands at `to` in the resulting list.
 *
 * `to` is read against the list *without* the dragged column already removed,
 * which is how a drop indicator between two headers reads to the eye: dropping
 * on the gap before index 3 means "become the fourth column", whatever was
 * there before.
 */
export function moveColumn(order: ColKey[], key: ColKey, to: number): ColKey[] {
  const from = order.indexOf(key);
  if (from < 0) return order;
  const rest = order.filter((k) => k !== key);
  // Removing the column shifts everything after it one to the left, so a drop
  // past its old position has to come back by one to land where it looked.
  const index = Math.max(0, Math.min(rest.length, to > from ? to - 1 : to));
  rest.splice(index, 0, key);
  return rest;
}
