# Product Vision

**PFI (Personal Finance Index)** — working name, centrally configured in `src/lib/config/branding.ts` — turns an individual or household's finances into something that feels like managing and analyzing a publicly traded company.

## Core thesis

PFI converts fragmented financial data into a transparent measure of financial resilience, momentum, and risk, then gives the user a clear next action.

Users create a fictional personal company identity (company name, ticker, username) and see their finances as a stock-terminal-style performance dashboard. The product answers:

1. Where do I stand financially today?
2. Am I above or below my normal financial position?
3. Am I approaching or below my financial waterline?
4. What caused my financial position to move?
5. What actions could improve my financial health?
6. How am I performing against my own history?
7. How do I compare with anonymized users in similar cohorts?

## Principles

1. **Show financial position visually.** The primary interface is a chart: actual indexed position, personal baseline, financial waterline, forecast, event markers.
2. **Gamify improvement, not wealth.** Rankings use normalized behavior metrics (improvement, savings consistency, debt reduction, liquidity improvement) — never net worth, income, or absolute assets.
3. **AI interprets; deterministic code calculates.** Every number is produced by the typed calculation engine. AI narrates verified metrics; it never invents balances, recommends securities, or presents itself as a licensed professional.
4. **Privacy is part of the product.** Public profiles expose only the fictional company identity, indexed performance, percentiles, and broad cohort bands. Never real names, exact income, balances, employers, locations, or merchant details.
5. **Every score is explainable.** A score without an explanation is not acceptable. The score measures the current condition and direction of a user's finances, never their value as a person.
6. **Prioritized actions, not advice dumps.** The default experience answers: what is the single most useful financial action I can take next?

## Key conceptual distinctions (preserve everywhere)

- **Below average vs underwater.** Below personal baseline ≠ below waterline. Only label a user underwater when near-term obligations exceed the available financial position.
- **Market gains vs owner-created equity.** Contributions, debt reduction, and retained cash are the user's doing; market appreciation is not. Separate them.
- **Financial health vs wealth.** A wealthy user can have poor operating health; a lower-income user can demonstrate excellent discipline.
- **Education vs professional advice.** PFI is analytics, education, and decision support — never certified accounting, legal, tax, or registered investment advice.

## What the finished platform should feel like

A stock-performance dashboard for an individual; a personal financial operating system; a financial-health coach; a gamified but responsible improvement platform; an anonymized household benchmark network; and eventually a source of privacy-safe aggregate household financial intelligence.

Success is users understanding *why* their position changed and *what to do next* — and needing the app less as their finances improve, not more.
