"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { completeOnboarding } from "@/app/actions/onboarding";
import { onboardingSchema, type OnboardingValues } from "@/lib/validation/onboarding";
import { AGE_COHORTS, COL_CATEGORIES, HOUSEHOLD_TYPES, INCOME_BANDS, OBJECTIVES } from "@/lib/config/cohorts";
import { Card } from "@/components/ui/Card";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";
const labelCls = "text-sm font-medium text-primary";

export function OnboardingForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { loadDemo: true } as Partial<OnboardingValues> as OnboardingValues,
    mode: "onTouched",
  });
  const { register, handleSubmit, trigger, formState: { errors, isSubmitting } } = form;

  async function next() {
    if (await trigger(["companyName", "ticker", "username"])) setStep(2);
  }

  async function onSubmit(values: OnboardingValues) {
    setServerError(null);
    const result = await completeOnboarding(values);
    if (result?.error) setServerError(result.error);
  }

  return (
    <Card className="p-6">
      <p className="mb-4 text-xs text-tertiary" aria-live="polite">Step {step} of 2</p>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        {step === 1 && (
          <>
            <Field label="Company name" error={errors.companyName?.message}>
              <input className={inputCls} placeholder="Koa Holdings" {...register("companyName")} />
            </Field>
            <Field label="Ticker (2–5 letters)" error={errors.ticker?.message}>
              <input className={`${inputCls} uppercase`} placeholder="KOAH" maxLength={5} {...register("ticker")} />
            </Field>
            <Field label="Username" error={errors.username?.message}>
              <input className={inputCls} placeholder="IslandBuilder" {...register("username")} />
            </Field>
            <button type="button" onClick={next} className="mt-2 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base">
              Continue
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <Field label="Age range" error={errors.ageCohort?.message}>
              <Select options={AGE_COHORTS} {...register("ageCohort")} />
            </Field>
            <Field label="Household income" error={errors.incomeBand?.message}>
              <Select options={INCOME_BANDS} {...register("incomeBand")} />
            </Field>
            <Field label="Household type" error={errors.householdType?.message}>
              <Select options={HOUSEHOLD_TYPES} {...register("householdType")} />
            </Field>
            <Field label="Cost of living" error={errors.colCohort?.message}>
              <Select options={COL_CATEGORIES} {...register("colCohort")} />
            </Field>
            <Field label="Primary objective" error={errors.objective?.message}>
              <select className={inputCls} defaultValue="" {...register("objective")}>
                <option value="" disabled>Select…</option>
                {OBJECTIVES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="checkbox" {...register("loadDemo")} className="size-4" />
              Load sample data so I can explore first
            </label>
            {serverError && <p className="text-sm text-negative" role="alert">{serverError}</p>}
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={() => setStep(1)} className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary">
                Back
              </button>
              <button type="submit" disabled={isSubmitting} className="flex-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60">
                {isSubmitting ? "Creating…" : "Create my company"}
              </button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={labelCls}>{label}</label>
      {children}
      {error && <p className="text-xs text-negative" role="alert">{error}</p>}
    </div>
  );
}

function Select({ options, ...rest }: { options: readonly string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={inputCls} defaultValue="" {...rest}>
      <option value="" disabled>Select…</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
