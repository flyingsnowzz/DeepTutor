"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus, login } from "@/lib/auth";

export default function AdministratorLoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchAuthStatus().then((status) => {
      if (status?.authenticated && status.is_admin) router.replace("/admin/users");
    });
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const result = await login(username, password, true);
    if (result.ok) {
      router.replace("/admin/users");
      return;
    }
    setError(result.error ?? t("Login failed"));
    setLoading(false);
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-2 text-center font-serif text-2xl font-semibold">DeepTutor</h1>
      <p className="mb-8 text-center text-sm text-[var(--muted-foreground)]">
        {t("Administrator sign in")}
      </p>
      <form onSubmit={submit} className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-8 py-8 shadow-sm">
        <label className="block text-sm font-medium">
          {t("Email or username")}
          <input className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3.5 py-2.5" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          {t("Password")}
          <input className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3.5 py-2.5" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
        <button disabled={loading} className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50">
          {loading ? t("Signing in…") : t("Sign in")}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
        <Link href="/login" className="text-[var(--primary)] hover:underline">{t("User sign in")}</Link>
      </p>
    </div>
  );
}
