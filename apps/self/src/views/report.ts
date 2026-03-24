import { page } from "../components/page.ts";
import { renderErrorReport } from "shared/components/error-report.ts";
import { submitReport } from "shared/api/client.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  renderErrorReport(el, { apiSubmit: (body) => submitReport(body as Parameters<typeof submitReport>[0]) });
  return el;
}

export const reportView = page(renderContent);
