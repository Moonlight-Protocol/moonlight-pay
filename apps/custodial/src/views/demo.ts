import { page } from "../components/page.ts";
import { renderDemoTab } from "shared/components/demo-tab.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  renderDemoTab(el);
  return el;
}

export const demoView = page(renderContent);
