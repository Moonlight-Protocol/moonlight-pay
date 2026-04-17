import { getConnectedAddress, isAuthenticated } from "../../lib/wallet.ts";
import { isPlatformAuthed } from "../../lib/api.ts";
import { isAllowed } from "../../lib/config.ts";
import { navigate } from "../../lib/router.ts";
import {
  ONBOARDING_STEPS,
  type OnboardingStepId,
} from "../../lib/onboarding.ts";

export function onboardingPage(
  currentStep: OnboardingStepId,
  renderStep: () => HTMLElement | Promise<HTMLElement>,
): () => Promise<HTMLElement> {
  return async () => {
    const addr = getConnectedAddress();
    if (
      !isAuthenticated() || !isPlatformAuthed() || (addr && !isAllowed(addr))
    ) {
      navigate("/login");
      return document.createElement("div");
    }

    const wrapper = document.createElement("div");
    wrapper.className = "login-container";

    const inner = document.createElement("div");

    // Stepper — above the card
    const stepper = document.createElement("div");
    stepper.className = "onboarding-stepper";

    const currentIdx = ONBOARDING_STEPS.findIndex((s) => s.id === currentStep);

    for (let i = 0; i < ONBOARDING_STEPS.length; i++) {
      const step = ONBOARDING_STEPS[i];
      const stepEl = document.createElement("div");
      stepEl.className = "onboarding-step";
      if (i < currentIdx) stepEl.classList.add("done");
      if (i === currentIdx) stepEl.classList.add("active");

      const dot = document.createElement("span");
      dot.className = "step-dot";
      dot.textContent = i < currentIdx ? "\u2713" : String(i + 1);

      const label = document.createElement("span");
      label.className = "step-label";
      label.textContent = step.label;

      stepEl.append(dot, label);
      stepper.appendChild(stepEl);

      if (i < ONBOARDING_STEPS.length - 1) {
        const line = document.createElement("div");
        line.className = "step-line";
        if (i < currentIdx) line.classList.add("done");
        stepper.appendChild(line);
      }
    }

    inner.appendChild(stepper);

    // Card with step content
    const card = document.createElement("div");
    card.className = "login-card";

    const content = document.createElement("div");
    content.className = "onboarding-content";
    const rendered = await renderStep();
    content.appendChild(rendered);
    card.appendChild(content);

    inner.appendChild(card);
    wrapper.appendChild(inner);
    return wrapper;
  };
}
