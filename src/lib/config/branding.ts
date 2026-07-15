/**
 * Centralized branding configuration.
 * The product name is provisional — rename the product by editing this file only.
 * Nothing else in the app should hard-code the product name.
 */
export const branding = {
  productName: "PFI",
  productFullName: "Personal Finance Index",
  tagline: "Your personal financial performance, indexed.",
  /** Used in <title> and PWA manifest */
  appTitle: "PFI — Personal Finance Index",
  description:
    "See your household finances like a public company: an indexed performance chart, a personal baseline, a financial waterline, and clear explanations of what moved your line.",
} as const;

export type Branding = typeof branding;
