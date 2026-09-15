# Plaid Personal Finance Category taxonomies (fixtures)

Committed verbatim from Plaid's published documents so `map-category.test.ts` can
assert that every detailed value in each version maps to a PFI category:

- `pfc-v1.csv` — https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv
  (columns: PRIMARY, DETAILED, DESCRIPTION)
- `pfc-v2.csv` — https://plaid.com/documents/pfc-taxonomy-all.csv
  (columns: PFCv2 Primary, PFCv2 Detailed, PFCv2 Description, PFCv1 Primary, PFCv1 Detailed, PFCv1 Description;
  the second line is a Plaid note, not a row)

Fetched 2026-09-14. Re-fetch when Plaid announces taxonomy changes; the test
fails loudly on any new detailed value the mapper does not know.
