import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Network-to-ICP Workbench",
  description: "Open-source network mapping and ideal-customer-profile matching.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
