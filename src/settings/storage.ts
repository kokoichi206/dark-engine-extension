export type Settings = {
  readonly enabled: boolean;
  readonly excludedDomains: readonly string[];
};

export function loadSettings(): Promise<Settings> {
  return chrome.storage.local.get<Settings>({
    enabled: true,
    excludedDomains: [],
  });
}
