"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { apiFetch, apiUrl } from "@/lib/api";
import { fetchAuthStatus } from "@/lib/auth";

type Administrator = {
  id: string;
  username: string;
  super_admin: boolean;
};

export default function AdministratorAccountsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [administrators, setAdministrators] = useState<Administrator[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await apiFetch(apiUrl("/api/auth/admin/accounts"));
    if (!response.ok) throw new Error(t("Failed to load administrators"));
    const data = await response.json() as { administrators: Administrator[] };
    setAdministrators(data.administrators);
  }, [t]);

  useEffect(() => {
    void fetchAuthStatus().then((status) => {
      if (!status?.authenticated) router.replace("/admin/login");
      else if (!status.is_super_admin) router.replace("/admin/users");
      else void load().catch((failure) => setError(String(failure)));
    });
  }, [router, load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch(apiUrl("/api/auth/admin/accounts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : t("Failed to create administrator"));
      setUsername("");
      setPassword("");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Failed to create administrator"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href="/admin/users" className="text-sm text-[var(--primary)] hover:underline">{t("Back")}</Link>
        <h1 className="font-serif text-2xl font-semibold">{t("Administrators")}</h1>
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {administrators.map((admin) => (
            <li key={admin.id} className="flex justify-between px-4 py-3 text-sm">
              <span>{admin.username}</span>
              <span className="text-[var(--muted-foreground)]">{admin.super_admin ? t("Super administrator") : t("Administrator")}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="font-medium">{t("Create administrator")}</h2>
          <input className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2" placeholder={t("Email or username")} autoComplete="off" required value={username} onChange={(event) => setUsername(event.target.value)} />
          <input className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2" type="password" placeholder={t("Password (≥ 8 chars)")} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button disabled={saving} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50">{t("Create administrator")}</button>
        </form>
      </div>
    </main>
  );
}
