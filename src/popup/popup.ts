import { findExcludedDomain } from "../settings/domains";
import { loadSettings } from "../settings/storage";

const toggle = document.querySelector<HTMLInputElement>("#enabled")!;
const reloadButton = document.querySelector<HTMLButtonElement>("#reload")!;
const excludeButton =
  document.querySelector<HTMLButtonElement>("#exclude-domain")!;
const optionsButton =
  document.querySelector<HTMLButtonElement>("#open-options")!;
const currentDomain = document.querySelector<HTMLElement>("#current-domain")!;
const domainDescription = document.querySelector<HTMLParagraphElement>(
  "#domain-description",
)!;
const statusText = document.querySelector<HTMLParagraphElement>("#status")!;

function showError(error: unknown): void {
  statusText.textContent =
    error instanceof Error ? error.message : String(error);
}
function showDomain(
  hostname: string,
  excludedDomains: readonly string[],
): void {
  currentDomain.textContent = hostname;
  const matched = findExcludedDomain(hostname, excludedDomains);
  excludeButton.disabled = matched !== undefined;
  excludeButton.textContent = matched
    ? "除外済み"
    : "このドメイン配下で無効にする";
  domainDescription.textContent = matched
    ? `${matched} とそのサブドメインは除外されています。解除は設定画面から行えます。`
    : "このドメインと、そのサブドメインを除外します。";
}
async function initialize(): Promise<void> {
  const settings = await loadSettings();
  toggle.checked = settings.enabled;
  toggle.disabled = false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  reloadButton.disabled = tab?.id === undefined;
  toggle.addEventListener("change", () => {
    toggle.disabled = true;
    reloadButton.disabled = true;
    void chrome.storage.local
      .set({ enabled: toggle.checked })
      .then(() => {
        statusText.textContent =
          "設定を保存しました。再読み込みすると反映されます。";
      })
      .catch(showError)
      .finally(() => {
        toggle.disabled = false;
        reloadButton.disabled = tab?.id === undefined;
      });
  });
  reloadButton.addEventListener("click", () => {
    if (tab?.id === undefined) return;
    void chrome.tabs
      .reload(tab.id)
      .then(() => window.close())
      .catch(showError);
  });
  optionsButton.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage().catch(showError);
  });
  if (tab?.id === undefined) return;
  let hostname: string;
  try {
    const response: { readonly hostname: string } =
      await chrome.tabs.sendMessage(
        tab.id,
        { type: "get-page-hostname" },
        { frameId: 0 },
      );
    hostname = response.hostname;
  } catch {
    currentDomain.textContent = "ドメインを取得できません";
    domainDescription.textContent =
      "対象ページを再読み込みするか、設定画面でドメインを入力してください。";
    return;
  }
  if (!hostname) {
    currentDomain.textContent = "このページはドメイン除外の対象外です";
    return;
  }
  showDomain(hostname, settings.excludedDomains);
  excludeButton.addEventListener("click", () => {
    excludeButton.disabled = true;
    void loadSettings()
      .then(async (current) => {
        const excludedDomains = [
          ...new Set([
            ...current.excludedDomains,
            hostname.toLowerCase().replace(/\.$/, ""),
          ]),
        ].sort();
        await chrome.storage.local.set({ excludedDomains });
        showDomain(hostname, excludedDomains);
        statusText.textContent =
          "除外を保存しました。再読み込みすると反映されます。";
      })
      .catch((error) => {
        excludeButton.disabled = false;
        showError(error);
      });
  });
}
void initialize().catch(showError);
