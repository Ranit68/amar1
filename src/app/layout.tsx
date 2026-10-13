import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "পাইকারি হিসাব · Wholesale Manager",
  description:
    "দোকানের বিক্রয়, স্টক, খরচ ও দৈনিক হিসাব এক অ্যাপে — West Bengal wholesale store manager.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="bn">
      <body>{children}</body>
    </html>
  );
}
