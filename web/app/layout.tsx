import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Finanzas Marco",
  description: "Lo que entra, lo que sale y dónde queda",
};

const NAV = [
  { href: "/", label: "Resumen" },
  { href: "/patrimonio", label: "Patrimonio" },
  { href: "/moni", label: "Moni" },
  { href: "/revisar", label: "Revisar" },
  { href: "/importar", label: "Importar" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <header className="border-b border-line bg-card">
          <nav className="mx-auto flex max-w-5xl items-center gap-4 overflow-x-auto whitespace-nowrap px-4 py-3 text-sm">
            <span className="font-semibold">Finanzas</span>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-muted hover:text-fg">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
