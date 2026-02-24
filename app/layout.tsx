import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clawnch Operator",
  description: "Trading operator console for launch, copytrade, and fee workflows",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
