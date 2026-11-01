import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { signIn } from "@/auth";

async function login(form: FormData) {
  "use server";
  try {
    await signIn("credentials", { email: form.get("email"), password: form.get("password"), redirectTo: "/" });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login?error=1");
    throw err;
  }
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <form action={login} className="mx-auto mt-16 max-w-sm space-y-3 rounded-2xl border border-line bg-card p-6">
      <h1 className="text-center text-lg font-semibold">Finanzas</h1>
      <Suspense fallback={null}>
        <LoginError searchParams={searchParams} />
      </Suspense>
      <input name="email" type="email" autoComplete="username" placeholder="Email" required className="block w-full rounded-md border border-line bg-bg px-3 py-2 text-sm" />
      <input name="password" type="password" autoComplete="current-password" placeholder="Contraseña" required className="block w-full rounded-md border border-line bg-bg px-3 py-2 text-sm" />
      <button className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white">Entrar</button>
    </form>
  );
}

async function LoginError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  if (!error) return null;
  return <p className="text-center text-sm text-neg">Email o contraseña incorrectos.</p>;
}
