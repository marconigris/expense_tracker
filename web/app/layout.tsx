import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { auth, authDisabled } from "@/auth";
import { db, t } from "@/lib/db";
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
  { href: "/tarifa", label: "Tarifa" },
  { href: "/periodo", label: "Movimientos" },
  { href: "/revisar", label: "Revisar" },
  { href: "/importar", label: "Importar" },
];

const PARTNER_NAV = [
  { href: "/compartido", label: "Balance" },
  { href: "/compartido/cargar", label: "Cargar gasto" },
  { href: "/compartido/importar", label: "Importar CSV" },
];

async function Navigation() {
  await connection();
  let role: "owner" | "partner" | undefined;
  if (authDisabled) role = "owner";
  else {
    const email = (await auth())?.user?.email?.toLowerCase();
    if (email) {
      const [user] = await db.select({ role: t.users.role }).from(t.users).where(eq(t.users.email, email));
      role = user?.role;
    }
  }
  const nav = role === "owner" ? NAV : role === "partner" ? PARTNER_NAV : [];
  return <nav className="mx-auto flex max-w-5xl items-center gap-4 overflow-x-auto whitespace-nowrap px-4 py-3 text-sm">
    <span className="font-semibold">Finanzas</span>
    {nav.map((n) => <Link key={n.href} href={n.href} className="text-muted hover:text-fg">{n.label}</Link>)}
  </nav>;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <header className="border-b border-line bg-card">
          <Suspense fallback={<div className="mx-auto max-w-5xl px-4 py-3 text-sm font-semibold">Finanzas</div>}><Navigation /></Suspense>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
