import { Suspense } from "react";
import { signIn } from "@/auth";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4 rounded-2xl border border-line bg-card p-6 text-center">
      <h1 className="text-lg font-semibold">Finanzas</h1>
      <Suspense fallback={null}>
        <LoginError searchParams={searchParams} />
      </Suspense>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white">Entrar con Google</button>
      </form>
    </div>
  );
}

async function LoginError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  if (!error) return null;
  return <p className="text-sm text-neg">Esta cuenta de Google no tiene acceso.</p>;
}
