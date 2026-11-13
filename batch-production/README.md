# Batch-production version — first research delivery

Online entry point: https://aleexjohanssonn.github.io/PWA_TFG/batch-production/

The separate entry point in the source is `batch-production/index.html`. No build or package installation is required. Existing `con-stock/` and `servicios/` files are not changed.

## Files

- `core.js`: domain validation and immutable commands. Also exports a CommonJS module for Node tests.
- `app.js`: DOM, forms and browser persistence adapter.
- `styles.css`: responsive styling using the existing app's general colours and Spanish language.
- `sw.js`: scope-specific precache, offline fallback and versioned asset cleanup.
- `manifest.json`: install identity, resources and scope for this version.

## Data contract (schema 1)

The complete state is saved as JSON under `pwa_tfg_batch_v1`. No `pwa_v9_*` keys are read or written. Arrays contain products, materials, purchases, batches and sales. `nextSequence` supplies stable identities and deterministic recording order; each event also stores an ISO timestamp.

Money is integer cents. Time is integer seconds. Raw-material quantities support six decimal places; finished-goods quantities are whole items. Material purchases are valued using the current remaining stock value divided by quantity. A production stores the consumed quantity and cost for each material and locks those costs for that event.

A batch stores total and remaining finished quantity, cost and production time. A sale stores product, quantity, payment, additional selling time and per-batch allocations (`batchId`, `qty`, `costCents`, `productionSeconds`). FIFO is based on recorded production sequence, not physical traceability. Final-item allocation consumes any rounding remainder.

`Core.apply(state, command, input)` validates and returns `{state, result}` without mutating the input. Commands are `product`, `purchase`, `produce`, `sell`, `cancelSale`, `cancelProduction`. `Core.stock`, `Core.totals` and `Core.saleTotals` provide small derived views. Cancellations remain in history and are omitted from active derived totals.

Cash is paid sales minus recorded purchases, with zero initial cash in this delivery. Production is a stock transformation, not another payment. Per-sale amount after material cost excludes overhead, tax and other expenses. Its hourly figure uses allocated production time plus additional selling time. It is not return on all actual work performed in that period. Do not sum allocated production seconds with actual batch time as separate work.

The UI saves the whole validated state with one `localStorage.setItem` before adopting it. Storage errors do not intentionally commit partial in-memory state. A last-loaded-value check and storage event guard protect against ordinary stale-tab writes, but do not provide atomic compare-and-swap across concurrent tabs. Use one active tab.

## Corrections and limits

Sale cancellation restores its exact original allocations and excludes the payment. Production cancellation is blocked while active sales refer to it, then restores original consumption quantity and value. These are record corrections, not real customer returns. Purchase editing/cancellation, unrestricted historic edits, raw-stock adjustments, opening finished stock, finished-goods losses, mixed-product production, export/import and cloud sync are outside this delivery.

Legacy data remains separate; missing product counts and separate time components are not inferred from old sales. A future migration or shared statistics interface requires an explicit agreement. No formal API or integration with the other student's decision-support work is claimed.

## Verification

`node --test tests/batch-core.test.cjs tests/batch-sw.test.cjs` from the repository root: 17 checks pass as of 2 November 2026. Browser walkthrough: purchase 3 kg for 300, produce 30 items in 180 minutes, sell 8 for 400 with 12 selling minutes; 22 remain, assigned cost is 80 and cash is 100. Overselling and production cancellation with dependencies were blocked. Persistence was checked after reopening. Product and production views have no horizontal document overflow at 320 px; the 360 px layout was inspected.

Offline precache/fallback has simulated tests and browser installation completed locally. Disconnected physical-phone use, installed-version upgrades, browser storage failure/recovery and full assistive-technology testing still require additional verification. No user-study results are available.

## Updating

Change `RELEASE` in `sw.js` whenever cached assets change. Only the new worker's owned prefix is cleaned up. Older application workers still have their original cache cleanup behaviour; no changes have been made to them. Use a separate local origin/port for batch testing. Before eventual production use alongside the legacy versions, consider their broader cache cleanup behaviour and test cross-version installation and offline use.
