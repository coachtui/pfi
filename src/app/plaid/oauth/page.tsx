import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { OauthReturn } from "./OauthReturn";

export const metadata: Metadata = { title: `Finishing your bank sign-in — ${branding.productName}` };

/**
 * Plaid OAuth return URL (spec §1a). Behind the proxy's auth gate like every
 * other page; all the work happens client-side in OauthReturn, which resumes
 * the Link session stored before the redirect.
 */
export default function PlaidOauthPage() {
  return <OauthReturn />;
}
