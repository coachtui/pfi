# Information Security Policy

**Organization:** AIGA LLC ("the Company")
**System in scope:** PFI (Personal Finance Index), the web application at https://pfi-one.vercel.app, its source repository, its Supabase project, its Vercel project, and its Plaid integration.
**Owner:** Owner and Head of Engineering, AIGA LLC — security contact: security@aigaai.com (monitored, forwards to the owner).
**Version:** 1.0 — effective 2026-09-15. Reviewed at least annually and on any material change to the system.

This policy states what must be true of PFI and how it is enforced. The technical detail behind each control lives in `docs/SECURITY_MODEL.md`, `docs/DATA_MODEL.md`, `docs/AI_RECOMMENDATION_POLICY.md`, and the decision log `docs/DECISIONS.md`; where this document and those conflict, this document is the policy and the others are the implementation record.

## 1. Scope and roles

1.1 The Company is a single-member LLC. The owner is accountable for every control in this policy and is the sole holder of production credentials. There is no separate security team; the roles below name responsibilities, not people.

1.2 **Information Security Owner:** approves this policy, owns risk decisions, responds to incidents, manages vendors, and holds all administrative accounts.

1.3 **Engineering:** implements controls, follows the secure development process in §6, and keeps the implementation record current.

1.4 Anyone who later joins the Company or is granted access to any in-scope system must read and follow this policy before receiving access.

## 2. Data classification

| Class | Examples | Handling |
| --- | --- | --- |
| **Restricted** | Third-party access tokens (Plaid), the database service-role key, encryption keys, API keys, user password hashes | Server-side only; encrypted at rest where the platform does not already do so; never logged, never in client code, never in chat, tickets, or screenshots |
| **Confidential** | A user's financial account names, masked account numbers, balances, transactions, categories, driver events, snapshots, score history; email address; onboarding cohort answers | Stored per user under database row-level security; visible only to the owning user; never sold, shared for marketing, or used for credit decisions |
| **Internal** | Source code, architecture and decision documents, test fixtures, Sandbox test data | Access limited to the owner and any contributor the owner authorizes |
| **Public** | The product's public-profile surfaces (fictional company identity, indexed values, percentiles, broad bands), legal pages, marketing text | Must never contain a real identity, a dollar amount, or a merchant name |

2.1 The application collects the minimum needed to compute a user's own metrics: authentication email, broad onboarding cohorts (never exact salary), and the financial data the user enters, imports, or connects. Bank credentials are never collected; bank sign-in happens inside Plaid's hosted flow.

2.2 Product analytics never receive raw balances, transaction values, or merchant names.

## 3. Access control

3.1 **User access.** Every user authenticates with email or username plus password through Supabase Auth. Passwords are stored as salted hashes the Company cannot read. Minimum password length is 8, breached-password protection is enabled, and email confirmation is required before a session is issued. Password reset uses single-use, device-independent tokens.

3.2 **Tenant isolation.** Every table holding user data has row-level security enabled with default-deny, owner-only policies (`auth.uid() = user_id`). Isolation is enforced in the database, not only in application code, and is verified by an automated cross-tenant test suite (`pnpm test:rls`) that provisions two real users against the live project and asserts that every cross-tenant read, insert, update, and delete fails. That suite must pass before any change touching data access is merged.

3.3 **Administrative access.** The database service-role key is used by exactly the server-side operations that require it (secret storage, user administration) and is never present in client bundles, `NEXT_PUBLIC_*` variables, or logs. Administrative accounts (GitHub, Vercel, Supabase, Plaid, the domain and mail provider) are held by the owner only, protected by unique passwords in a password manager and multi-factor authentication.

3.4 **Least privilege at the database.** Database functions run as the caller (`security invoker`) and assert ownership of every row they touch. Tables that hold Restricted data (third-party token ciphertext) have row-level security enabled with no policies and no grants to application roles, so the browser client cannot read them even in principle.

3.5 **Third-party access.** Plaid receives only an opaque user identifier, never an email, name, or PFI data. The Company stores Plaid's masked account number, never a full account number.

## 4. Cryptography and secrets

4.1 All traffic is served over HTTPS. Data at rest is encrypted by the hosting and database providers (Vercel, Supabase).

4.2 Third-party access tokens are additionally encrypted at the application layer with AES-256-GCM (random 96-bit IV, authenticated, tamper-detecting) before storage. The encryption key is a server-only environment variable; a key fingerprint is stored with each ciphertext so keys can be rotated without downtime using the documented rotation procedure (`scripts/rotate-plaid-key.mts`, dry-run first).

4.3 Secrets live only in the hosting provider's environment configuration and in the owner's local `.env.local`, which is excluded from version control. Production secrets are never placed in a development environment. Secrets are never printed to a terminal, pasted into chat, committed, or included in screenshots. A secret that is exposed is rotated immediately (§8).

4.4 Cryptographic key material is generated with a cryptographically secure random source (32 random bytes for symmetric keys).

## 5. Logging, monitoring, and privacy of logs

5.1 Application logs record event types, error codes, request identifiers, and internal record identifiers. They never record tokens, passwords, account numbers, masks, balances, amounts, transaction descriptions, or merchant names. Third-party API failures are logged as error type, error code, and request id only.

5.2 Hosting, database, and authentication logs are retained on the providers' schedules and reviewed when an incident is suspected and during the annual review.

5.3 User-facing error messages are generic; internal error detail goes to server logs, not to the screen.

## 6. Secure development and change management

6.1 All source code is in a version-controlled repository. No change reaches production except by merge to the main branch, which the hosting provider deploys automatically.

6.2 Every change is made on a branch and merged through a pull request. Direct commits to the main branch are prohibited.

6.3 Before merge, a change must pass linting, type checking, the unit test suite, and a production build. Changes touching authentication, authorization, data access, third-party integrations, or personal data must additionally pass the row-level-security suite, receive an independent security review and (for schema changes) a database review, and have review findings fixed or explicitly recorded as accepted risk in `docs/KNOWN_LIMITATIONS.md`.

6.4 Every significant architecture or security decision is recorded in `docs/DECISIONS.md` with alternatives and reasoning. Known gaps are recorded, not hidden.

6.5 Financial calculations are deterministic code with tests. AI features receive only structured, pre-computed metrics and return schema-validated output; they never receive raw transactions, merchant names, credentials, or free-form user data (see `docs/AI_RECOMMENDATION_POLICY.md`).

6.6 Database schema changes are applied through numbered, version-controlled migrations recorded in the project's migration history. Migrations are additive by default; destructive changes require an explicit decision record.

6.7 Dependencies are pinned through the lockfile and updated deliberately. Security advisories for direct dependencies are reviewed when raised by the package manager or repository host.

6.8 Development happens on the owner's machine with full-disk encryption enabled and a screen lock. Test data in Sandbox is synthetic; real user data is never copied to a development machine.

## 7. Vendor and third-party risk

7.1 In-scope processors and what they hold:

| Vendor | Role | Data |
| --- | --- | --- |
| Vercel | Hosting, build, environment secrets | Application code, server logs, environment variables |
| Supabase | Database, authentication, storage | All Confidential data, password hashes, token ciphertext |
| Plaid | Bank data access (only for accounts a user chooses to connect) | Opaque user id; the bank connection itself lives at Plaid |
| Email delivery provider | Authentication and transactional email | User email addresses |
| AI gateway provider (optional, when configured) | Narration of pre-computed metrics | Structured metrics only, no raw financial rows |

7.2 A vendor is added only after reviewing what data it will receive, whether it is bound to process that data solely on the Company's behalf, and how it can be removed. The privacy policy names the processors that receive personal data and is versioned; a material change re-prompts every user for consent.

7.3 Vendor credentials follow §3.3 and §4.3. Vendor access is removed when the vendor is retired.

## 8. Incident response

8.1 A security incident is any suspected unauthorized access to, disclosure of, or loss of Restricted or Confidential data, or any exposure of a secret.

8.2 Response steps, in order:
1. **Contain.** Revoke or rotate the affected credential immediately: rotate the token-encryption key with the rotation procedure; rotate the service-role key in Supabase and Vercel; for a compromised bank connection, call Plaid's item removal for the affected Items so access at the institution ends; reset affected user passwords and invalidate sessions.
2. **Assess.** Determine from provider logs what data was reachable, by whom, and for how long. Record the timeline.
3. **Notify.** Inform affected users by email without undue delay, and Plaid through its support channel where a Plaid Item or Plaid data is involved, within the timeframes their agreements require.
4. **Remediate.** Fix the root cause through the normal change process (§6), with a decision record.
5. **Review.** Within two weeks, record what happened, what was changed, and any follow-up in `docs/DECISIONS.md` or `docs/KNOWN_LIMITATIONS.md`.

8.3 Users can report security concerns to security@aigaai.com. Reports are acknowledged within two business days.

## 9. Data retention, deletion, and user rights

9.1 Confidential data is kept while the user's account exists. Users can view, correct, export, and delete their data; requests the product does not yet cover in the UI are handled by email within 30 days.

9.2 Disconnecting a bank connection revokes access at Plaid first, then removes the stored token; history is kept unless the user chooses "Disconnect and delete data", which removes every account, balance, and transaction from that connection.

9.3 Deleting a user removes all of that user's rows through database cascades. Before a user is deleted, every active bank connection is disconnected so that access at Plaid is revoked and billing stops (see the runbook in `docs/SECURITY_MODEL.md`).

9.4 Backups are managed by the database provider on its schedule and age out on that schedule. Restoration is tested when a material schema change or provider migration makes it prudent, and at least during the annual review.

## 10. Business continuity

10.1 The application is stateless at the hosting layer and can be redeployed from the repository at any time. All persistent state is in the database provider, which provides automated backups and point-in-time recovery on its plan. The owner keeps the ability to recreate every environment variable from the password manager.

10.2 Loss of any single vendor is recoverable: code is portable, the database is standard Postgres, and Plaid connections can be re-established by users.

## 11. Compliance with this policy

11.1 Exceptions are permitted only with a written entry in `docs/KNOWN_LIMITATIONS.md` naming the gap, the risk, and the intended resolution.

11.2 The owner reviews this policy, the implementation record, administrative-account MFA status, vendor list, and open exceptions at least annually and on any material change to the system, and records the review date here.

| Review date | Reviewer | Outcome |
| --- | --- | --- |
| 2026-09-15 | Owner | Initial version, written alongside Plaid production onboarding |
