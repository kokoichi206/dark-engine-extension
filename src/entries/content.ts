import { startDomEngine } from "../engine/dom-engine";
import { findExcludedDomain } from "../settings/domains";
import { loadSettings } from "../settings/storage";

// about:srcdoc / about:blank のような文書は、継承されたオリジンで判定する。
const hostname =
  location.hostname ||
  (window.origin === "null" ? "" : new URL(window.origin).hostname);
chrome.runtime.onMessage.addListener(
  (message: { readonly type: string }, _sender, sendResponse) => {
    if (message.type === "get-page-hostname") sendResponse({ hostname });
  },
);

async function initialize(): Promise<void> {
  const settings = await loadSettings();
  const enabled =
    settings.enabled &&
    findExcludedDomain(hostname, settings.excludedDomains) === undefined;
  // MAIN world へ渡すのは描画の有効状態だけで、拡張 API やページデータは渡さない。
  function start(): void {
    document.documentElement.setAttribute(
      "data-dark-engine-enabled",
      enabled ? "on" : "off",
    );
    if (enabled) startDomEngine();
  }
  if (document.documentElement) start();
  else {
    const observer = new MutationObserver(() => {
      if (document.documentElement) {
        observer.disconnect();
        start();
      }
    });
    observer.observe(document, { childList: true });
  }
}
void initialize().catch(console.error);
