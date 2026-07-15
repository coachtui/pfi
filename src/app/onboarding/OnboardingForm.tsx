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
            <Field id="companyName" label="Company name" error={errors.companyName?.message}>
              <input id="companyName" aria-invalid={!!errors.companyName} aria-describedby={errors.companyName ? "companyName-error" : undefined} className={inputCls} placeholder="Koa Holdings" {...register("companyName")} />
            </Field>
            <Field id="ticker" label="Ticker (2–5 letters)" error={errors.ticker?.message}>
              <input id="ticker" aria-invalid={!!errors.ticker} aria-describedby={errors.ticker ? "ticker-error" : undefined} className={`${inputCls} uppercase`} placeholder="KOAH" maxLength={5} {...register("ticker")} />
            </Field>
            <Field id="username" label="Username" error={errors.username?.message}>
              <input id="username" aria-invalid={!!errors.username} aria-describedby={errors.username ? "username-error" : undefined} className={inputCls} placeholder="IslandBuilder" {...register("username")} />
            </Field>
            <button type="button" onClick={next} className="mt-2 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base">
              Continue
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <Field id="ageCohort" label="Age range" error={errors.ageCohort?.message}>
              <Select id="ageCohort" aria-invalid={!!errors.ageCohort} aria-describedby={errors.ageCohort ? "ageCohort-error" : undefined} options={AGE_COHORTS} {...register("ageCohort")} />
            </Field>
            <Field id="incomeBand" label="Household income" error={errors.incomeBand?.message}>
              <Select id="incomeBand" aria-invalid={!!errors.incomeBand} aria-describedby={errors.incomeBand ? "incomeBand-error" : undefined} options={INCOME_BANDS} {...register("incomeBand")} />
            </Field>
            <Field id="householdType" label="Household type" error={errors.householdType?.message}>
              <Select id="householdType" aria-invalid={!!errors.householdType} aria-describedby={errors.householdType ? "householdType-error" : undefined} options={HOUSEHOLD_TYPES} {...register("householdType")} />
            </Field>
            <Field id="colCohort" label="Cost of living" error={errors.colCohort?.message}>
              <Select id="colCohort" aria-invalid={!!errors.colCohort} aria-describedby={errors.colCohort ? "colCohort-error" : undefined} options={COL_CATEGORIES} {...register("colCohort")} />
            </Field>
            <Field id="objective" label="Primary objective" error={errors.objective?.message}>
              <select id="objective" aria-invalid={!!errors.objective} aria-describedby={errors.objective ? "objective-error" : undefined} className={inputCls} defaultValue="" {...register("objective")}>
                <option value="" disabled>Select…</option>
                {OBJECTIVES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <label htmlFor="loadDemo" className="flex items-center gap-2 text-sm text-primary">
              <input id="loadDemo" type="checkbox" {...register("loadDemo")} className="size-4" />
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

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
      {error && <p id={`${id}-error`} className="text-xs text-negative" role="alert">{error}</p>}
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
