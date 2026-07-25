import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const data = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-data",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "DealRadar — Know When.", template: "%s · DealRadar" },
  description:
    "L'avantage informationnel sur la seconde main : sachez quand acheter, quand attendre, quand vendre.",
};

export const viewport: Viewport = {
  themeColor: "#0D1017",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`dark ${sans.variable} ${data.variable}`}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
