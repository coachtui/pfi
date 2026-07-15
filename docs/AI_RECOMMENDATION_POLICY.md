# AI Recommendation Policy

Status: binding policy for the Phase 4 AI layer; the deterministic groundwork (drivers, status, momentum) already follows it.

## Architecture rule

```
financial data → transaction normalization → deterministic calculation engine
  → rules & opportunity engine → AI explanation layer → user-facing output
```

All numbers are calculated in application code before reaching AI. AI receives **structured verified metrics** (typed JSON, never raw database access) and returns **schema-validated output** (Zod). AI explanations must be traceable to calculated metrics — AI may rephrase `computeDrivers()` output; it may not invent a driver.

## AI may

- Explain what moved the user's line (from deterministic driver output)
- Summarize performance; explain metrics in plain language
- Generate bounded, personalized suggestions with stated assumptions and confidence
- Explain scenario results calculated by the engine
- Produce monthly/quarterly reports; answer questions over verified user data
- Ask the user questions when data appears inconsistent

## AI must not

- Invent balances, transactions, or drivers; calculate balances independently
- Recommend specific securities to buy or sell
- Present tax or legal conclusions as authoritative
- Present itself as a CPA, CFP, attorney, or registered investment adviser
- Guarantee financial outcomes
- Penalize intentional financial decisions without understanding the user's goal
- Make lending, insurance-eligibility, or credit-underwriting decisions
- Present probabilistic estimates as facts

## Recommendation categories

**Green (direct educational guidance):** cash-flow management, expense patterns, savings goals, emergency reserves, bill timing, debt-payment scenarios, goal progress, general financial education.

**Yellow (cautious wording + explicit assumptions + disclaimers):** retirement projections, home affordability, tax estimates, insurance considerations, long-term market-return assumptions, credit-health education.

**Red (never automated):** specific securities, personalized portfolio allocation, tax filing decisions, legal conclusions, lending decisions, credit underwriting, debt-settlement representation, guaranteed outcomes.

Every recommendation card must contain: observation, why it matters, suggested action, **impact estimated by code**, assumptions, confidence, and data coverage — plus "Why am I seeing this?".

## Tone

No shame-oriented language. No celebration of extreme spending restriction. Specific and measurable, never vague ("Your emergency runway declined from 4.1 to 3.5 months", not "your finances may need attention"). Avoid generic advice ("spend less", "make a budget").

## Logging

AI prompt/response logging must redact sensitive raw data. One user's data must never appear in another user's AI context.
