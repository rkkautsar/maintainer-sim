export const seedSteps = [
  "load_scenario",
  "read_repository",
  "validate_baseline",
  "pin_baseline",
  "create_milestone",
  "list_issues",
  "create_master_issue",
  "create_player_issues",
  "seed_proposals",
  "update_master_issue",
  "send_story_touches",
  "activate_run",
] as const;

export type SeedStep = (typeof seedSteps)[number];

export function seedStepFrom(error: unknown): SeedStep | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function"))
    return undefined;
  const step = (error as { step?: unknown }).step;
  return typeof step === "string" && seedSteps.includes(step as SeedStep)
    ? (step as SeedStep)
    : undefined;
}

function attachSeedStep(error: unknown, step: SeedStep): unknown {
  if (error && (typeof error === "object" || typeof error === "function")) {
    try {
      Object.defineProperty(error, "step", {
        value: step,
        configurable: true,
      });
      return error;
    } catch {
      // Frozen provider errors still get a safe wrapper below.
    }
  }
  const wrapped = new Error(
    error instanceof Error ? error.message : "Seed operation failed",
    { cause: error },
  ) as Error & {
    step?: SeedStep;
    status?: unknown;
  };
  wrapped.name = error instanceof Error ? error.name : "Error";
  const status =
    error && (typeof error === "object" || typeof error === "function")
      ? (error as { status?: unknown }).status
      : undefined;
  if (typeof status === "number") wrapped.status = status;
  wrapped.step = step;
  return wrapped;
}

export async function atSeedStep<T>(
  step: SeedStep,
  action: () => T | Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw attachSeedStep(error, step);
  }
}
