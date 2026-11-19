import "./globals.css";
import type { Metadata } from "next";
import { Baloo_Da_2, Fredoka, Nunito } from "next/font/google";

const sans = Nunito({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Fredoka({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const bengali = Baloo_Da_2({ subsets: ["bengali"], weight: ["500", "600"], variable: "--font-bengali", display: "swap" });

export const metadata: Metadata = {
  title: { default: "BdREN AI", template: "%s · BdREN AI" },
  description:
    "AI tools for the universities and offices of Bangladesh: Synapse, Mindspear, AI Mail Wizard and QuiGen, under one BdREN sign-in.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${bengali.variable}`}>
      <body className="min-h-screen bg-ground font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
