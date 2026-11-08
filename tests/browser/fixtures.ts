import {
  test as base,
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  contrastRatio,
  overOpaque,
  readCssRgba,
  relativeLuminance,
  type Rgb,
} from "../support/visual-contract";

export const test = base.extend<{
  extensionContext: BrowserContext;
  extensionId: string;
  page: Page;
}>({
  extensionContext: async ({}, use) => {
    const extensionPath = resolve("dist");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: !process.env.HEADED,
      viewport: { width: 1280, height: 1000 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ extensionContext }, use) => {
    const page = await extensionContext.newPage();
    await page.goto("chrome://extensions");
    const id = await page.locator("extensions-item").getAttribute("id");
    if (!id) throw new Error("拡張を読み込めませんでした。");
    await page.close();
    await use(id);
  },
  page: async ({ extensionContext }, use) => {
    await use(await extensionContext.newPage());
  },
});
export { expect };

export async function paintedImageCenter(locator: Locator): Promise<number[]> {
  const screenshot = await locator.screenshot();
  return locator.page().evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    return Array.from(
      ctx.getImageData(
        Math.floor(image.width / 2),
        Math.floor(image.height / 2),
        1,
        1,
      ).data,
    );
  }, screenshot.toString("base64"));
}

export async function readPaintedColors(
  locator: Locator,
  pseudo?: string,
): Promise<{ background: Rgb; foreground: Rgb }> {
  const painted = await locator.evaluate((element, pseudoElement) => {
    const style = getComputedStyle(element, pseudoElement);
    const backgrounds = [style.backgroundColor];
    let ancestor = pseudoElement ? element : element.parentElement;
    while (ancestor) {
      backgrounds.push(getComputedStyle(ancestor).backgroundColor);
      ancestor = ancestor.parentElement;
    }
    return {
      text: style.getPropertyValue("-webkit-text-fill-color") || style.color,
      backgrounds,
    };
  }, pseudo);
  let background: Rgb = [255, 255, 255];
  for (const css of painted.backgrounds.reverse())
    background = overOpaque(readCssRgba(css), background);
  return {
    background,
    foreground: overOpaque(readCssRgba(painted.text), background),
  };
}

export async function expectReadableDark(
  locator: Locator,
  pseudo?: string,
): Promise<void> {
  await expect
    .poll(async () =>
      relativeLuminance((await readPaintedColors(locator, pseudo)).background),
    )
    .toBeLessThan(0.1);
  await expect
    .poll(async () => {
      const { foreground, background } = await readPaintedColors(
        locator,
        pseudo,
      );
      return contrastRatio(foreground, background);
    })
    .toBeGreaterThanOrEqual(4.5);
}

export async function openPopup(
  context: BrowserContext,
  extensionId: string,
  target: Page,
): Promise<Page> {
  const popup = await context.newPage();
  await target.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole("switch")).toBeEnabled();
  return popup;
}

export async function setGlobalEnabled(
  context: BrowserContext,
  extensionId: string,
  target: Page,
  enabled: boolean,
): Promise<void> {
  const popup = await openPopup(context, extensionId, target);
  await popup.getByRole("switch").setChecked(enabled);
  await expect(popup.getByRole("status")).toContainText("設定を保存しました");
  await Promise.all([
    target.waitForEvent("domcontentloaded"),
    popup.getByRole("button", { name: "このページを再読み込み" }).click(),
  ]);
}

export async function routeSheetsFixture(page: Page): Promise<void> {
  const html = await readFile("tests/fixtures/page.html", "utf8");
  const script = await readFile("tests/fixtures/fixture.js", "utf8");
  await page.route("https://docs.google.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js")
      await route.fulfill({ body: script, contentType: "text/javascript" });
    else if (path === "/frame.html")
      await route.fulfill({
        body: '<body style="background:white;color:black">frame</body>',
        contentType: "text/html",
      });
    else if (path.startsWith("/spreadsheets/"))
      await route.fulfill({ body: html, contentType: "text/html" });
    else await route.fulfill({ status: 404, body: "" });
  });
}

export async function canvasPixel(
  page: Page,
  selector: string,
  x: number,
  y: number,
): Promise<number[]> {
  return page.locator(selector).evaluate(
    (element, point) => {
      const canvas = element as HTMLCanvasElement;
      return Array.from(
        canvas.getContext("2d")!.getImageData(point.x, point.y, 1, 1).data,
      );
    },
    { x, y },
  );
}
