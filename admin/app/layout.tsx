import type { Metadata } from "next";
import { Sora, Plus_Jakarta_Sans, Noto_Sans_Sinhala } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Sora carries headings and figures — geometric, a little unusual, and it holds
 * up at display size. Plus Jakarta Sans does the reading work. Sinhala sits in
 * the same stack as the body face so it never reads as a third voice.
 */
const display = Sora({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
        className={`${display.variable} ${body.variable} ${sinhala.variable} antialiased`}
        style={{ fontFamily: "var(--font-body), var(--font-sinhala), system-ui, sans-serif" }}
      >
        {children}
        <Toaster position="bottom-right" theme="dark" richColors />
      </body>
    </html>
  );
}
