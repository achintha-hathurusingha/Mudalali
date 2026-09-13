import type { Metadata } from "next";
import { Instrument_Serif, IBM_Plex_Sans, Noto_Sans_Sinhala } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Two voices, deliberately distinct: a high-contrast serif that only ever
 * speaks in headings and figures, and a workmanlike sans for everything the
 * owner actually reads. Sinhala sits in the same stack as the sans so it
 * resolves without reading as a third family.
 */
const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const sans = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const sinhala = Noto_Sans_Sinhala({
  variable: "--font-sinhala",
  subsets: ["sinhala"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Mudalali",
  description: "Run the shop: replies, stock, orders, and what the agent is allowed to do.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${sans.variable} ${sinhala.variable} antialiased`}
        style={{ fontFamily: "var(--font-plex), var(--font-sinhala), system-ui, sans-serif" }}
      >
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
