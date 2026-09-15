# Driver events — how PFI derives "what moved your line"

Driver events are the labelled moments PFI shows on the chart and in the
"What moved your line" panel: paychecks, bonuses, mortgage payments,
investment contributions, debt payments and payoffs, tax and insurance
payments, large purchases, and unexpected expenses. They **explain** the
line; they never change it. Snapshots, the waterline, and the score are
computed from balances and transactions alone, so a wrong event is a wrong
explanation, not a wrong number. That is why every rule below is
conservative: a missed event is preferable to an invented one.

Two provenances live in `financial_events.source`:

| source    | Written by                                   | Rebuilt?                       |
| --------- | -------------------------------------------- | ------------------------------ |
| `demo`    | The demo loader (authored with the dataset)  | Never; removed by "clear demo" |
| `derived` | `deriveEvents()` from the household's data   | Replaced wholesale per rebuild |

Derived rows carry the `transaction_id` they came from and the
`derivation_version` that produced them. Demo accounts are never derived.
Decision record: `docs/DECISIONS.md` #44.

## Inputs

`deriveEvents` (in `src/lib/financial-engine/derived-events.ts`) is pure. It
receives:

- **Accounts** — only accounts that are not demo, not archived, and included
  in calculations produce events.
- **Effective transactions** — the user's category override is applied, so a
  purchase you recategorise to groceries stops being a large purchase on the
  next rebuild. Descriptions stay as the source recorded them, because series
  keys and your confirm/dismiss choices are built from source descriptions;
  a description override therefore does not relabel an event. Plaid's
  personal-finance category (`pfc_primary`, `pfc_detailed`) rides along when
  present; CSV-imported rows have none.
- **Recurring series** — the same series the Recurring page shows, plus your
  confirm/dismiss status. A transaction "belongs" to a series when its account,
  direction, and normalised description match. A series counts only when you
  confirmed it, or when it has at least three occurrences at medium or high
  confidence and you have not dismissed it.
- **Liability balance history** (optional) — used only to tell a payoff from a
  payment. When absent, a payment is never called a payoff.

Each transaction yields at most one event. Rules are checked in the order
listed; the first match wins.

## Version v1 rules

### Income

| Event      | Rule                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `paycheck` | An inflow to a liquid account that belongs to an income series with weekly, biweekly, semimonthly, or monthly cadence; **or** Plaid labels it `INCOME_SALARY` / `INCOME_WAGES`. |
| `bonus`    | An inflow that belongs to an income series at any other cadence (a quarterly bonus, an annual payout); **or** a one-off inflow categorised as income that is at least **max($500, 1.5 × the median paycheck series amount)**. Without a paycheck series the one-off rule is off. |

### Transfers and obligations

| Event                     | Rule                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mortgage_payment`        | Plaid labels it `LOAN_PAYMENTS_MORTGAGE_PAYMENT`; **or** it is the outflow side of a transfer pair whose other side lands in a mortgage account; **or** it belongs to a housing series whose name contains "mortgage". |
| `investment_contribution` | The outflow side of a transfer pair into a brokerage or retirement account; **or** (unpaired) Plaid labels it `TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS`. Counted once, on the outflow side. |
| `debt_payment`            | The outflow side of a transfer pair into any other liability (credit card, loan, line of credit); **or** (unpaired) Plaid's primary category is `LOAN_PAYMENTS`.                       |
| `debt_payoff`             | A `debt_payment` where the liability's balance history is at or below zero at every point on or after the payment date. Needs balance history; otherwise stays a payment.             |
| `tax_payment`             | Plaid labels it `GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT`.                                                                                                                              |
| `insurance_payment`       | Categorised as insurance **and** belongs to a recurring series. A single insurance charge is not an event.                                                                             |

A plain transfer between two liquid accounts (checking to savings) is never
an event.

### One-off spending

Only non-transfer outflows on spending accounts (checking, savings, money
market, credit card) that do **not** belong to a recurring series are considered.

| Event                | Rule                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `unexpected_expense` | Category is health or housing; **or** Plaid labels it medical, home repair/maintenance, or automotive service; **and** it clears the bar. |
| `large_purchase`     | Category is shopping, discretionary, transport, or other; **and** it clears the bar.                                                    |

**The bar is relative to the household.** For a transaction on day D, take
every one-off outflow in the 90 days before D (same eligibility as above).
If there are at least five, the bar is
**max($250, 2.5 × their median)**; with fewer samples the bar is $250. So a
household whose typical one-off purchase is $80 flags anything from $250 up,
while one whose typical purchase is $200 needs $500 before a purchase is
called large. Recurring bills never enter the median, so a big mortgage
does not raise the bar.

**Monthly cap.** Per calendar month and per type, only the three largest
events survive. A month with eight big purchases shows the three biggest;
the rest remain ordinary transactions.

### What v1 deliberately does not do

- No `debt_payoff` without liability balance history.
- No events from accounts you excluded or archived.
- No events for demo accounts (the demo dataset authors its own).
- No use of merchant names beyond the series match; labels are the series
  name when there is one, otherwise the transaction description.

## Versioning

`EVENT_DERIVATION_VERSION` is stamped on every derived row. Any rule
change — a new threshold, a new category, a reordered rule — bumps the
version, and the next rebuild replaces every derived row for the household.
Old rows are never patched in place, so an event's provenance is always
"these rules, this transaction". Demo rows are unaffected by version bumps.

## Where the rebuild runs

Derived events are regenerated at the tail of every snapshot rebuild
(`rebuildSnapshots`), from the same loaded accounts, transactions, overrides,
and anchors: after an import or account mutation finishes, after a
connected-account sync commits, and when the dashboard repairs a stale index.
Liability balance history for payoff detection comes from each liability's
effective balance anchor rolled through its transactions; a liability with no
anchor never yields a payoff. See `src/lib/data/rebuild-derived-events.ts`.
