import "./globals.css";
import type { Metadata } from "next";
import { Inter, Noto_Sans_Bengali, Space_Grotesk } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], weight: ["500"], variable: "--font-bengali", display: "swap" });

export const metadata: Metadata = {
  title: { default: "BdREN AI", template: "%s · BdREN AI" },
  description:
    "AI tools for the universities and offices of Bangladesh: Synapse, Mindspear, AI Mail Wizard and QuiGen, under one BdREN sign-in.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${bengali.variable}`}>
      <body className="min-h-screen bg-ground font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
