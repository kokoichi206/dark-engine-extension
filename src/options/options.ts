import { parseExcludedDomains } from "../settings/domains";
import { loadSettings } from "../settings/storage";

const form = document.querySelector<HTMLFormElement>("#domain-settings")!;
const domainsInput =
  document.querySelector<HTMLTextAreaElement>("#excluded-domains")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save")!;
const errorText =
  document.querySelector<HTMLParagraphElement>("#domain-error")!;
const statusText = document.querySelector<HTMLParagraphElement>("#status")!;
const domainCount = document.querySelector<HTMLSpanElement>("#domain-count")!;

function showError(error: unknown): void {
  errorText.textContent =
    error instanceof Error ? error.message : String(error);
}
function showDomains(domains: readonly string[]): void {
  domainsInput.value = domains.join("\n");
  domainCount.textContent = `登録 ${domains.length} 件`;
}
async function saveDomains(): Promise<void> {
  const parsed = parseExcludedDomains(domainsInput.value);
  statusText.textContent = "";
  errorText.textContent = "";
  domainsInput.removeAttribute("aria-invalid");
  if (!parsed.ok) {
    errorText.textContent = parsed.error;
    domainsInput.setAttribute("aria-invalid", "true");
    domainsInput.focus();
    return;
  }
  saveButton.disabled = true;
  domainsInput.disabled = true;
  try {
    await chrome.storage.local.set({ excludedDomains: parsed.domains });
    showDomains(parsed.domains);
    statusText.textContent =
      "設定を保存しました。対象ページを再読み込みすると反映されます。";
  } finally {
    saveButton.disabled = false;
    domainsInput.disabled = false;
  }
}
async function initialize(): Promise<void> {
  const settings = await loadSettings();
  showDomains(settings.excludedDomains);
  domainsInput.disabled = false;
  saveButton.disabled = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveDomains().catch(showError);
  });
  domainsInput.addEventListener("input", () => {
    statusText.textContent = "";
    errorText.textContent = "";
    domainsInput.removeAttribute("aria-invalid");
  });
}
void initialize().catch(showError);
