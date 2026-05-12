import { renderStepper } from "@moonlight/ui/stepper";
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

    // Stepper above the card.
    const stepper = renderStepper({
      steps: ONBOARDING_STEPS,
      currentStepId: currentStep,
    });
    inner.appendChild(stepper);

    // Card with step content.
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
