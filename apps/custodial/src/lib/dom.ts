export function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function renderError(container: HTMLElement, title: string, message: string): void {
  container.textContent = "";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.className = "error-text";
  p.textContent = message;
  container.append(h2, p);
}
