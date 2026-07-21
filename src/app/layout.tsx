import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BottomNav } from "@/components/nav/BottomNav";
import { TermSheetProvider } from "@/components/concepts/TermSheetProvider";
import { branding } from "@/lib/config/branding";
import { createClient } from "@/lib/supabase/server";
import { getCompletedConceptIds } from "@/lib/data/queries";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: branding.appTitle,
  description: branding.description,
  applicationName: branding.productName,
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d0f",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const completedConceptIds = await getCompletedConceptIds(supabase);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TermSheetProvider completedConceptIds={completedConceptIds}>
          <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-28">{children}</main>
          <BottomNav />
        </TermSheetProvider>
      </body>
    </html>
  );
}
