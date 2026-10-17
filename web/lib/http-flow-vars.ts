import type { HttpStep } from "@/lib/api";

export const EXTRACT_VAR_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Variable names defined by extract rules in steps before `beforeIndex` (0-based). */
export function varsDefinedBefore(steps: HttpStep[], beforeIndex: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < beforeIndex; i++) {
    for (const name of Object.keys(steps[i].extract ?? {})) {
      const n = name.trim();
      if (n && !out.has(n)) out.set(n, i);
    }
  }
  return out;
}

export type ExtractOverrideWarning = {
  variable: string;
  /** First step index (0-based) that defined this name. */
  firstDefinedStep: number;
};

/** Warn when this step redefines a variable from an earlier step (later value wins at runtime). */
export function extractOverrideWarnings(steps: HttpStep[], stepIndex: number): ExtractOverrideWarning[] {
  const prior = varsDefinedBefore(steps, stepIndex);
  const warnings: ExtractOverrideWarning[] = [];
  for (const name of Object.keys(steps[stepIndex]?.extract ?? {})) {
    const n = name.trim();
    if (!n) continue;
    const first = prior.get(n);
    if (first !== undefined) {
      warnings.push({ variable: n, firstDefinedStep: first });
    }
  }
  return warnings;
}

/** Names available for {{var}} in step `stepIndex` (from all prior steps). */
export function availableTemplateVars(steps: HttpStep[], stepIndex: number): string[] {
  const names = new Set<string>();
  for (let i = 0; i < stepIndex; i++) {
    for (const name of Object.keys(steps[i].extract ?? {})) {
      const n = name.trim();
      if (n && EXTRACT_VAR_NAME.test(n)) names.add(n);
    }
  }
  return [...names].sort();
}
