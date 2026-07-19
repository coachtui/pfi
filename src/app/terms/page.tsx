import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { TERMS_VERSION } from "@/lib/legal/versions";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: `Terms of Service — ${branding.productName}` };

export default function TermsPage() {
  const name = branding.productName;
  return (
    <LegalPage title="Terms of Service" version={TERMS_VERSION}>
      <section>
        <h2>1. Agreement</h2>
        <p>
          By creating an account you agree to these Terms of Service and to the Privacy Policy. If
          you do not agree, do not use {name}.
        </p>
      </section>
      <section>
        <h2>2. What {name} is — and is not</h2>
        <p>
          {name} is an educational analytics tool that presents your household finances the way a
          public company presents its performance. It is <strong>not</strong> financial, investment,
          tax, or legal advice, and no output — including any score — is a credit score or a
          recommendation to buy or sell anything. Decisions you make remain your own.
        </p>
      </section>
      <section>
        <h2>3. Your account</h2>
        <p>
          You must provide a valid email address and keep your password confidential. You are
          responsible for activity under your account. You may close your account at any time,
          which deletes your data as described in the Privacy Policy.
        </p>
      </section>
      <section>
        <h2>4. Your data, your ownership</h2>
        <p>
          Financial data you enter or import remains yours. You grant {name} only the processing
          rights needed to compute and display your own metrics. We never sell your data.
        </p>
      </section>
      <section>
        <h2>5. Acceptable use</h2>
        <p>
          Do not attempt to access other users&rsquo; data, probe or disrupt the service, or use it
          for unlawful purposes.
        </p>
      </section>
      <section>
        <h2>6. Accuracy and availability</h2>
        <p>
          Calculations are deterministic and explainable, but depend on the completeness of the data
          you provide. The service is provided &ldquo;as is&rdquo;, without warranty, and may change
          or be interrupted while in active development.
        </p>
      </section>
      <section>
        <h2>7. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, {name} is not liable for indirect or
          consequential damages, or for financial outcomes of decisions informed by the product.
        </p>
      </section>
      <section>
        <h2>8. Changes</h2>
        <p>
          If these terms materially change, the version above changes and you will be asked to
          review and accept the new version at your next sign-in before continuing.
        </p>
      </section>
      <section>
        <h2>9. Contact</h2>
        <p>Questions: tui@tuialailima.com.</p>
      </section>
    </LegalPage>
  );
}
