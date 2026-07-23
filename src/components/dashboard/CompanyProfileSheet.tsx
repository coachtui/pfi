"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { CompanyEmblem } from "@/components/dashboard/CompanyEmblem";
import { updateCompanyProfile } from "@/app/actions/company-profile";
import { companyProfileSchema, type CompanyProfileValues } from "@/lib/validation/company-profile";
import { COMPANY_PRESETS } from "@/lib/config/company-presets";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";
const labelCls = "text-sm font-medium text-primary";

export function CompanyProfileSheet({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial: { companyName: string; ticker: string; username: string; logoPath: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CompanyProfileValues>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: {
      companyName: initial.companyName,
      ticker: initial.ticker.replace(/^\$/, ""),
      username: initial.username,
      logoPath: initial.logoPath,
    },
  });
  const selected = watch("logoPath");

  const submit = (values: CompanyProfileValues) => {
    setServerError(null);
    startTransition(async () => {
      const result = await updateCompanyProfile(values);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  const choose = (logoPath: string | null) => setValue("logoPath", logoPath, { shouldDirty: true });

  return (
    <Sheet open={open} onClose={onClose} title="Edit company">
      <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-3">
        <label className={labelCls} htmlFor="cp-name">Company name</label>
        <input id="cp-name" className={inputCls} placeholder="Koa Holdings" {...register("companyName")} />
        {errors.companyName && <p role="alert" className="text-xs text-negative">{errors.companyName.message}</p>}

        <label className={labelCls} htmlFor="cp-ticker">Ticker</label>
        <input id="cp-ticker" className={`${inputCls} uppercase`} placeholder="KOAH" maxLength={5} {...register("ticker")} />
        {errors.ticker && <p role="alert" className="text-xs text-negative">{errors.ticker.message}</p>}

        <label className={labelCls} htmlFor="cp-username">Username</label>
        <input id="cp-username" className={inputCls} placeholder="IslandBuilder" {...register("username")} />
        {errors.username && <p role="alert" className="text-xs text-negative">{errors.username.message}</p>}

        <span className={labelCls}>Emblem</span>
        <div role="radiogroup" aria-label="Company emblem" className="grid grid-cols-4 gap-2">
          <EmblemOption label="Default" logoPath={null} selected={selected == null} onSelect={() => choose(null)} />
          {COMPANY_PRESETS.map((p) => {
            const value = `preset:${p.id}`;
            return (
              <EmblemOption key={p.id} label={p.label} logoPath={value} selected={selected === value} onSelect={() => choose(value)} />
            );
          })}
        </div>

        {serverError && <p role="alert" className="text-sm text-negative">{serverError}</p>}

        <div className="mt-2 flex gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="flex-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function EmblemOption({
  label,
  logoPath,
  selected,
  onSelect,
}: {
  label: string;
  logoPath: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className={`relative flex flex-col items-center gap-1 rounded-xl border p-2 ${selected ? "border-positive" : "border-border-subtle"}`}
    >
      <CompanyEmblem logoPath={logoPath} size="sm" />
      {selected && <Check size={14} aria-hidden className="absolute right-1 top-1 text-positive" />}
      <span className="text-[10px] text-tertiary">{label}</span>
    </button>
  );
}
