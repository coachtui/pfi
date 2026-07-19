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
          financial account, balance, and transaction data you enter or import into {name}.
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
          No third parties receive your personal data except infrastructure processors (hosting,
          database, email delivery) bound to process it only on our behalf.
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
