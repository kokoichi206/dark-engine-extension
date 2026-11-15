export type ParsedDomains =
  | { readonly ok: true; readonly domains: readonly string[] }
  | { readonly ok: false; readonly error: string };

export function parseExcludedDomains(source: string): ParsedDomains {
  const domains: string[] = [];
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const input = line.trim();
    if (!input) continue;
    const error = `行 ${index + 1}: ドメインだけを入力してください（例: example.com）。URL、パス、ポート、* は指定できません。`;
    const bracketedAddress = input.startsWith("[") && input.endsWith("]");
    if (
      /[\s/@?#*\\%]/u.test(input) ||
      (!bracketedAddress && input.includes(":"))
    )
      return { ok: false, error };
    let domain: string;
    try {
      domain = new URL(`https://${input}`).hostname.replace(/\.$/, "");
    } catch {
      return { ok: false, error };
    }
    if (
      domain.length > 253 ||
      (!domain.startsWith("[") &&
        !domain
          .split(".")
          .every((label) =>
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
          ))
    ) {
      return { ok: false, error };
    }
    domains.push(domain);
  }
  return { ok: true, domains: [...new Set(domains)].sort() };
}

export function findExcludedDomain(
  hostname: string,
  domains: readonly string[],
): string | undefined {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return domains.find(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}
