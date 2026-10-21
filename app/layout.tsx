import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { getRequestLocale } from "@/lib/i18n/server";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const serif = Source_Serif_4({
  variable: "--font-serif-display",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TING",
    template: "%s · TING",
  },
  description:
    "TING er en plattform for private fellesskap. Én konto, flere organisasjoner — uten et offentlig register over hvem som finnes her.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={await getRequestLocale()} className={`${inter.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
