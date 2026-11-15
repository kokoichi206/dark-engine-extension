import {
  test,
  expect,
  expectReadableDark,
  readPaintedColors,
  setGlobalEnabled,
  canvasPixel,
  paintedImageCenter,
} from "./fixtures";
import {
  contrastRatio,
  readCssRgba,
  relativeLuminance,
} from "../support/visual-contract";

test("通常ページの本文・フォーム・疑似要素・Shadow DOM・フレームが暗い背景で読める", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/");
  for (const locator of [
    page.locator("body"),
    page.locator(".red p"),
    page.getByRole("link", { name: "リンクの読みやすさ" }),
    page.getByRole("textbox"),
    page.locator("#shadow p"),
    page.frameLocator('iframe[title="フレームの検証"]').locator("body"),
    page.frameLocator('iframe[title="srcdoc の検証"]').locator("body"),
  ])
    await expectReadableDark(locator);
  await expectReadableDark(page.locator(".card").first(), "::before");
  await expectReadableDark(page.getByRole("textbox"), "::placeholder");
  await expect(page.locator(".already-dark")).toHaveCSS(
    "background-color",
    "rgb(22, 27, 34)",
  );
  await expect
    .poll(async () => {
      const rect = readCssRgba(
        await page
          .locator("svg rect")
          .evaluate((element) => getComputedStyle(element).fill),
      );
      const text = readCssRgba(
        await page
          .locator("svg text")
          .evaluate((element) => getComputedStyle(element).fill),
      );
      return {
        dark: relativeLuminance(rect) < 0.1,
        readable: contrastRatio(rect, text) >= 4.5,
      };
    })
    .toEqual({ dark: true, readable: true });
});

test("追加要素と inline style の変更後も、最新の背景と文字が読める", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/");
  await expectReadableDark(page.locator("body"));
  // 初期ロード由来の再走査で、後から追加される要素を偶然拾わないようにする。
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "要素を追加" }).click();
  const added = page.locator("#dynamic p");
  await expectReadableDark(added);
  const before = (await readPaintedColors(added)).background;
  await added.evaluate((element) =>
    element.setAttribute(
      "style",
      "background:rgb(255,200,190);color:rgb(70,0,0)",
    ),
  );
  await expect
    .poll(async () => (await readPaintedColors(added)).background)
    .not.toEqual(before);
  await expectReadableDark(added);
  const updated = (await readPaintedColors(added)).background;
  expect(updated[0]).toBeGreaterThan(updated[2]);
});

test("CSSOM に追加された背景色と hover の配色を取り込み、読みやすさを保つ", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/");
  await expectReadableDark(page.locator(".cross-origin"));
  // load と初回 CSSOM 検出による再走査が、後続の変更を偶然拾わないようにする。
  await page.waitForTimeout(2000);
  const before = (await readPaintedColors(page.locator(".cross-origin")))
    .background;
  await page.evaluate(() => {
    const sheet = document.querySelector("style")!.sheet!;
    sheet.insertRule(
      ".cross-origin { background: rgb(255, 200, 190); }",
      sheet.cssRules.length,
    );
  });
  await expect
    .poll(
      async () =>
        (await readPaintedColors(page.locator(".cross-origin"))).background,
    )
    .not.toEqual(before);
  await expectReadableDark(page.locator(".cross-origin"));
  const button = page.getByRole("button", { name: "要素を追加" });
  const normal = (await readPaintedColors(button)).background;
  await button.hover();
  await expect
    .poll(async () => (await readPaintedColors(button)).background)
    .not.toEqual(normal);
  await expectReadableDark(button);
});

test("グラデーションの色を暗くし、背景画像の URL を壊さない", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/");
  await expectReadableDark(page.locator("body"));
  await expect
    .poll(async () => {
      const css = await page
        .locator(".gradient")
        .evaluate((element) => getComputedStyle(element).backgroundImage);
      const colors = css.match(/rgba?\([^)]+\)/g) ?? [];
      return (
        colors.length === 2 &&
        colors.every((color) => relativeLuminance(readCssRgba(color)) < 0.1)
      );
    })
    .toBe(true);
  const mixed = await page
    .locator(".mixed-background")
    .evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(mixed).toContain("http://127.0.0.1:4173/image.svg#fff");
  expect(mixed).toContain("linear-gradient");
  await expect
    .poll(async () =>
      page
        .locator(".mixed-background")
        .evaluate(
          (element) =>
            getComputedStyle(element).backgroundImage.match(/rgba?\([^)]+\)/g)
              ?.length,
        ),
    )
    .toBe(2);
});

test("ON/OFF はページの再読み込みと新しいタブに反映され、画像の見た目を変えない", async ({
  page,
  extensionContext,
  extensionId,
}) => {
  await page.goto("http://127.0.0.1:4173/");
  await expectReadableDark(page.locator("body"));
  const photo = page.getByAltText("画像の配色を保持");
  const darkImage = await paintedImageCenter(photo);
  expect(darkImage).toEqual([255, 153, 0, 255]);
  expect(await canvasPixel(page, "#art", 5, 5)).toEqual([255, 255, 255, 255]);
  await setGlobalEnabled(extensionContext, extensionId, page, false);
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(page.locator("body")).toHaveCSS("color", "rgb(17, 17, 17)");
  expect(await paintedImageCenter(photo)).toEqual(darkImage);
  const another = await extensionContext.newPage();
  await another.goto("http://127.0.0.1:4173/");
  await expect(another.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await setGlobalEnabled(extensionContext, extensionId, page, true);
  await expectReadableDark(page.locator("body"));
  expect(await paintedImageCenter(photo)).toEqual(darkImage);
});

test("スクリプト・inline CSS を拒否する CSP でも、現代的な色指定を読みやすく変換する", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|violates.*directive/i.test(message.text()))
      violations.push(message.text());
  });
  await page.goto("http://127.0.0.1:4173/strict.html");
  await expectReadableDark(page.locator("body"));
  await expectReadableDark(page.locator(".modern"));
  expect(violations).toEqual([]);
});
