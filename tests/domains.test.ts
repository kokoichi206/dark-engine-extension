import { describe, expect, it } from "vitest";
import {
  findExcludedDomain,
  parseExcludedDomains,
} from "../src/settings/domains";

function parsedDomainSet(source: string): Set<string> {
  const parsed = parseExcludedDomains(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return new Set(parsed.domains);
}

describe("除外ドメインの入力", () => {
  it("ポップアップから取得する IP アドレスも同じ形式で保存できる", () => {
    expect(parsedDomainSet("127.0.0.1\n[0:0:0:0:0:0:0:1]")).toEqual(
      new Set(["127.0.0.1", "[::1]"]),
    );
    expect(findExcludedDomain("[::1]", ["[::1]"])).toBe("[::1]");
    expect(parseExcludedDomains("[::1]:8080").ok).toBe(false);
  });
  it("大文字・末尾のドット・空行・重複を正規化する", () => {
    const parsed = parseExcludedDomains(
      "  EXAMPLE.COM.  \n\nexample.com\r\ndocs.google.com",
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(new Set(parsed.domains)).toEqual(
      new Set(["docs.google.com", "example.com"]),
    );
    expect(parsed.domains).toHaveLength(2);
  });
  it("日本語ドメインをブラウザと同じ ASCII 表記へ正規化する", () => {
    expect(parseExcludedDomains("例え.jp")).toEqual({
      ok: true,
      domains: ["xn--r8jz45g.jp"],
    });
  });
  it("空欄は除外の全解除として扱う", () => {
    expect(parseExcludedDomains("  \n")).toEqual({ ok: true, domains: [] });
  });
  it.each([
    "https://example.com",
    "example.com/path",
    "example.com:443",
    "*.example.com",
    "user@example.com",
    "example.com?x=1",
    "example.com#part",
    "not a domain",
    "-bad.example.com",
    "bad_.example.com",
    "a..example.com",
    "%65xample.com",
    "example.com\\path",
  ])("無効な指定を黙ってドメインへ広げない: %s", (input) => {
    const parsed = parseExcludedDomains(`valid.example\n${input}`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("行 2");
  });
});

describe("ドメインの境界", () => {
  it.each([
    "example.com",
    "app.example.com",
    "a.b.example.com",
    "EXAMPLE.COM.",
  ])("自身とサブドメインを除外する: %s", (hostname) => {
    expect(findExcludedDomain(hostname, ["example.com"])).toBe("example.com");
  });
  it.each([
    "notexample.com",
    "example.com.attacker.test",
    "otherexample.com",
    "example.net",
  ])("文字列の部分一致で別ドメインを除外しない: %s", (hostname) => {
    expect(findExcludedDomain(hostname, ["example.com"])).toBeUndefined();
  });
  it("登録したサブドメインの親や兄弟は除外しない", () => {
    expect(
      findExcludedDomain("example.com", ["app.example.com"]),
    ).toBeUndefined();
    expect(
      findExcludedDomain("other.example.com", ["app.example.com"]),
    ).toBeUndefined();
    expect(
      findExcludedDomain("nested.app.example.com", ["app.example.com"]),
    ).toBe("app.example.com");
  });
});
