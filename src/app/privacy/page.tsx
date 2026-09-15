import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { PRIVACY_VERSION } from "@/lib/legal/versions";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: `Privacy Policy — ${branding.productName}` };

export default function PrivacyPage() {
  const name = branding.productName;
  return (
    <LegalPage title="Privacy Policy" version={PRIVACY_VERSION}>
      <section>
        <h2>1. What we collect</h2>
        <p>
          Your email address and password hash (for authentication); the profile answers you give at
          onboarding (broad cohorts like age range and income band — never exact salary); and the
          financial account, balance, and transaction data you enter, import, or connect through a
          bank connection (see &ldquo;Connected accounts&rdquo; below) into {name}.
        </p>
      </section>
      <section id="connected-accounts">
        <h2>Connected accounts (Plaid)</h2>
        <p>
          You can link a bank or card account through Plaid Inc. (&ldquo;Plaid&rdquo;). When you do,
          you sign in at your institution inside Plaid&rsquo;s interface: your bank credentials go to
          Plaid and are never sent to or stored by {name}. Plaid then gives {name} an access token
          for that connection, which we store encrypted and use only to fetch your data.
        </p>
        <p>
          What {name} receives from Plaid: the connection&rsquo;s account names and types, the last
          digits of account numbers, current balances, and transactions (date, amount, description,
          merchant name where available, and Plaid&rsquo;s category). Nothing else — no full account
          numbers, no credentials, no identity documents.
        </p>
        <p>
          How long it is kept: as long as the connection or your account exists. Disconnecting an
          institution ends collection and revokes {name}&rsquo;s access at Plaid; your history stays
          in your account unless you choose &ldquo;Disconnect and delete data&rdquo;, which removes
          every account, balance, and transaction that came through that connection. Deleting your
          {name} account deletes all of it.
        </p>
        <p>
          Plaid&rsquo;s handling of your data is governed by its own{" "}
          <a href="https://plaid.com/legal/#end-user-privacy-policy" target="_blank" rel="noreferrer" className="underline underline-offset-4">
            End User Privacy Policy
          </a>
          . {name} uses Plaid only as a data-access processor and never sells or shares connected
          account data with anyone else.
        </p>
      </section>
      <section>
        <h2>2. How we use it</h2>
        <p>
          Solely to compute and show you your own metrics, index, and score. AI-generated
          commentary receives only structured, already-computed metrics — never your raw
          transactions or account credentials.
        </p>
      </section>
      <section>
        <h2>3. What we never do</h2>
        <p>
          We never sell your data. We never rank or expose users by wealth. Product analytics never
          receive raw balances, transaction values, or merchant names. Public surfaces show only
          your fictional company identity, indexed values, percentiles, and broad bands — never your
          real identity or dollar amounts.
        </p>
      </section>
      <section>
        <h2>4. Where it lives</h2>
        <p>
          Data is stored with Supabase (Postgres) with row-level security: every table is readable
          and writable only by the account that owns the rows. Passwords are stored as salted
          hashes; we cannot read them.
        </p>
      </section>
      <section>
        <h2>5. Sharing</h2>
        <p>
          No third parties receive your personal data except infrastructure processors bound to
          process it only on our behalf: hosting (Vercel), database and authentication (Supabase),
          email delivery, and — only for accounts you choose to connect — bank data access (Plaid).
        </p>
      </section>
      <section>
        <h2>6. Retention and deletion</h2>
        <p>
          Data is kept while your account exists. Deleting your account deletes your data (database
          rows cascade from your user record). Backups age out on the infrastructure provider&rsquo;s
          schedule.
        </p>
      </section>
      <section>
        <h2>7. Your rights</h2>
        <p>
          You can view, correct, export, or delete your data. Email tui@tuialailima.com for anything
          the product UI does not yet cover.
        </p>
      </section>
      <section>
        <h2>8. Changes</h2>
        <p>
          Material changes bump the version above, and you will be asked to review and accept the
          new version at your next sign-in.
        </p>
      </section>
    </LegalPage>
  );
}
