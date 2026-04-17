export const ONBOARDING_STEPS = [
  { id: "account", label: "Account" },
  { id: "treasury", label: "Treasury" },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];
