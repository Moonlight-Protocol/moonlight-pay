import { renderNav } from "./nav.ts";
import { isAuthenticated, isMasterSeedReady } from "../lib/wallet.ts";
import { isPlatformAuthed } from "../lib/api.ts";
import { navigate, RedirectAbort } from "../lib/router.ts";

/**
 * Wraps a view with the nav bar and full auth check.
 * Requires wallet connection, master seed, AND platform JWT.
 */
export function page(
  renderContent: () => HTMLElement | Promise<HTMLElement>,
): () => Promise<HTMLElement> {
  return async () => {
    if (!isAuthenticated() || !isMasterSeedReady() || !isPlatformAuthed()) {
      navigate("/login");
      // Throw the RedirectAbort sentinel so the router skips the render
      // entirely instead of attaching an empty wrapper while waiting for
      // the navigate-triggered hashchange (which would produce a visible
      // flash of empty content).
      throw new RedirectAbort();
    }

    const wrapper = document.createElement("div");
    wrapper.appendChild(renderNav());

    const main = document.createElement("main");
    main.className = "container";
    const content = await renderContent();
    main.appendChild(content);
    wrapper.appendChild(main);

    return wrapper;
  };
}
