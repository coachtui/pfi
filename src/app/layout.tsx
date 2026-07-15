import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BottomNav } from "@/components/nav/BottomNav";
import { branding } from "@/lib/config/branding";
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
};

export const viewport: Viewport = {
  themeColor: "#0b0d0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-6 pb-28">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
