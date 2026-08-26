import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Revenue Recovery | Razorpay Buildathon",
  description:
    "AI agent that detects revenue at risk, watches for customer self-recovery, and only intervenes when needed — recovering lost revenue safely with full audit trails.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
