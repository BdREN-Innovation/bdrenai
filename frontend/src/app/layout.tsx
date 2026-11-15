import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BDREN Identity & SaaS Entitlement Platform",
  description: "Centralized OIDC/SAML SSO, institutional federation, and SaaS subscription management for BDREN.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
