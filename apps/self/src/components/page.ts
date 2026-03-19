import { renderNav } from "./nav.ts";
import { isAuthenticated } from "../lib/wallet.ts";
import { hasPassword } from "../lib/derivation.ts";
import { navigate } from "../lib/router.ts";

export function page(renderContent: () => HTMLElement | Promise<HTMLElement>): () => Promise<HTMLElement> {
  return async () => {
    if (!isAuthenticated() || !hasPassword()) {
      navigate("/login");
      return document.createElement("div");
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
