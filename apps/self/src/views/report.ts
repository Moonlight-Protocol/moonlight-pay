import { page } from "../components/page.ts";
import { renderErrorReport } from "shared/components/error-report.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  renderErrorReport(el);
  return el;
}

export const reportView = page(renderContent);
