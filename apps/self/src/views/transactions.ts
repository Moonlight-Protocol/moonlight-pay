import { page } from "../components/page.ts";
import { renderTransactionList } from "shared/components/transaction-list.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  renderTransactionList(el);
  return el;
}

export const transactionsView = page(renderContent);
