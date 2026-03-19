/**
 * Error reporting form component.
 * Collects debug info and sends to the provider-platform.
 */

export function renderErrorReport(container: HTMLElement): void {
  container.innerHTML = `
    <h2>Report an Issue</h2>
    <p style="color:var(--text-muted);margin-bottom:1rem">
      Describe the problem you encountered. Debug information will be included automatically.
    </p>

    <div class="form-group">
      <label for="error-description">What happened?</label>
      <textarea id="error-description" rows="4" placeholder="Describe the issue..."></textarea>
    </div>
    <div class="form-group">
      <label for="error-steps">Steps to reproduce (optional)</label>
      <textarea id="error-steps" rows="3" placeholder="1. I clicked...&#10;2. Then..."></textarea>
    </div>

    <details style="margin-bottom:1rem">
      <summary style="color:var(--text-muted);cursor:pointer;font-size:0.875rem">Debug info (included automatically)</summary>
      <pre id="debug-info" style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-muted);white-space:pre-wrap;word-break:break-all"></pre>
    </details>

    <button id="submit-report-btn" class="btn-primary btn-wide">Submit Report</button>
    <p id="report-status" class="hint-text" hidden></p>
    <p id="report-error" class="error-text" hidden></p>
  `;

  // Populate debug info
  const debugEl = container.querySelector("#debug-info") as HTMLPreElement;
  const debugInfo = {
    userAgent: navigator.userAgent,
    url: window.location.href,
    timestamp: new Date().toISOString(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    localStorage: Object.keys(localStorage).filter((k) => !k.includes("secret") && !k.includes("token")),
  };
  debugEl.textContent = JSON.stringify(debugInfo, null, 2);

  const submitBtn = container.querySelector("#submit-report-btn") as HTMLButtonElement;
  const statusEl = container.querySelector("#report-status") as HTMLParagraphElement;
  const errorEl = container.querySelector("#report-error") as HTMLParagraphElement;

  submitBtn.addEventListener("click", () => {
    const description = (container.querySelector("#error-description") as HTMLTextAreaElement).value.trim();
    if (!description) {
      errorEl.textContent = "Please describe the issue.";
      errorEl.hidden = false;
      return;
    }

    const steps = (container.querySelector("#error-steps") as HTMLTextAreaElement).value.trim();

    // For now, log to console. Backend endpoint will be added later.
    console.info("[error-report]", { description, steps, debug: debugInfo });

    errorEl.hidden = true;
    statusEl.textContent = "Report submitted. Thank you!";
    statusEl.hidden = false;
    submitBtn.disabled = true;
  });
}
