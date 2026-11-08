import {
  test,
  expect,
  expectReadableDark,
  routeSheetsFixture,
  canvasPixel,
  setGlobalEnabled,
} from "./fixtures";
import { relativeLuminance } from "../support/visual-contract";

const sheetsUrl =
  "https://docs.google.com/spreadsheets/d/dark-engine-fixture/edit";

test("セルの再描画では背景を暗くして文字を明るくし、対象外 Canvas は保つ", async ({
  page,
  extensionContext,
  extensionId,
}) => {
  await routeSheetsFixture(page);
  await page.goto(sheetsUrl);
  await expectReadableDark(page.locator("body"));
  await page.getByRole("button", { name: "セルを再描画" }).click();
  const background = await canvasPixel(page, "#cells", 10, 10);
  expect(background[3]).toBe(255);
  expect(
    relativeLuminance([background[0]!, background[1]!, background[2]!]),
  ).toBeLessThan(0.1);
  const glyphs = await page.locator("#cells").evaluate((element) => {
    const ctx = (element as HTMLCanvasElement).getContext("2d")!;
    const pixels = ctx.getImageData(18, 30, 170, 30).data;
    let bright = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        pixels[i]! > 150 &&
        pixels[i + 1]! > 150 &&
        pixels[i + 2]! > 150 &&
        pixels[i + 3] === 255
      )
        bright++;
    return bright;
  });
  expect(glyphs).toBeGreaterThan(30);
  expect(await canvasPixel(page, "#art", 5, 5)).toEqual([255, 255, 255, 255]);
  await setGlobalEnabled(extensionContext, extensionId, page, false);
  await page.getByRole("button", { name: "セルを再描画" }).click();
  expect(await canvasPixel(page, "#cells", 10, 10)).toEqual([
    255, 255, 255, 255,
  ]);
});

test("ラップした Canvas API は描画を実行し、呼び出し直後の描画スタイルを変えない", async ({
  page,
}) => {
  await routeSheetsFixture(page);
  await page.goto(sheetsUrl);
  await expectReadableDark(page.locator("body"));
  const results = await page.locator("#cells").evaluate((element) => {
    const ctx = (element as HTMLCanvasElement).getContext("2d")!;
    ctx.clearRect(0, 0, 600, 100);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cccccc";
    ctx.lineWidth = 4;
    const observations: Array<{
      method: string;
      pixel: number[];
      fill: string | CanvasGradient | CanvasPattern;
      stroke: string | CanvasGradient | CanvasPattern;
    }> = [];
    const observe = (
      method: string,
      draw: () => void,
      x: number,
      y: number,
    ): void => {
      draw();
      observations.push({
        method,
        pixel: Array.from(ctx.getImageData(x, y, 1, 1).data),
        fill: ctx.fillStyle,
        stroke: ctx.strokeStyle,
      });
    };
    observe("fillRect", () => ctx.fillRect(0, 0, 20, 20), 10, 10);
    ctx.beginPath();
    ctx.rect(25, 0, 20, 20);
    observe("fill()", () => ctx.fill(), 35, 10);
    ctx.beginPath();
    ctx.rect(50, 0, 20, 20);
    observe("fill(rule)", () => ctx.fill("evenodd"), 60, 10);
    const first = new Path2D();
    first.rect(75, 0, 20, 20);
    observe("fill(path)", () => ctx.fill(first), 85, 10);
    const second = new Path2D();
    second.rect(100, 0, 20, 20);
    observe("fill(path, rule)", () => ctx.fill(second, "evenodd"), 110, 10);
    ctx.beginPath();
    ctx.rect(5, 40, 20, 20);
    observe("stroke()", () => ctx.stroke(), 5, 50);
    const outline = new Path2D();
    outline.rect(40, 40, 20, 20);
    observe("stroke(path)", () => ctx.stroke(outline), 40, 50);
    observe("strokeRect", () => ctx.strokeRect(75, 40, 20, 20), 75, 50);
    ctx.fillStyle = "#000000";
    ctx.strokeStyle = "#000000";
    ctx.font = "bold 24px monospace";
    const text: Array<{
      method: string;
      bright: number;
      rightmost: number;
      fill: string | CanvasGradient | CanvasPattern;
      stroke: string | CanvasGradient | CanvasPattern;
    }> = [];
    for (const [method, x, y, maxWidth] of [
      ["fillText", 160, 0, undefined],
      ["fillText", 160, 50, 28],
      ["strokeText", 360, 0, undefined],
      ["strokeText", 360, 50, 28],
    ] as const) {
      ctx.clearRect(x, y, 100, 45);
      if (method === "fillText") ctx.fillText("MMMM", x, y + 28, maxWidth);
      else ctx.strokeText("MMMM", x, y + 28, maxWidth);
      const pixels = ctx.getImageData(x, y, 100, 45).data;
      let bright = 0;
      let rightmost = -1;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! > 0) rightmost = Math.max(rightmost, (i / 4) % 100);
        if (
          pixels[i]! > 150 &&
          pixels[i + 1]! > 150 &&
          pixels[i + 2]! > 150 &&
          pixels[i + 3]! > 150
        )
          bright++;
      }
      text.push({
        method: `${method}${maxWidth ? "(maxWidth)" : ""}`,
        bright,
        rightmost,
        fill: ctx.fillStyle,
        stroke: ctx.strokeStyle,
      });
    }
    return { shapes: observations, text };
  });
  for (const result of results.shapes) {
    expect(result.pixel[3], result.method).toBe(255);
    expect(
      relativeLuminance([result.pixel[0]!, result.pixel[1]!, result.pixel[2]!]),
      result.method,
    ).toBeLessThan(0.1);
    expect(result.fill, result.method).toBe("#ffffff");
    expect(result.stroke, result.method).toBe("#cccccc");
    if (result.method.startsWith("stroke")) {
      const surface = results.shapes[0]!.pixel;
      expect(
        relativeLuminance([
          result.pixel[0]!,
          result.pixel[1]!,
          result.pixel[2]!,
        ]),
        result.method,
      ).toBeGreaterThan(
        relativeLuminance([surface[0]!, surface[1]!, surface[2]!]),
      );
    }
  }
  for (const result of results.text) {
    expect(result.bright, result.method).toBeGreaterThan(10);
    expect(result.fill, result.method).toBe("#000000");
    expect(result.stroke, result.method).toBe("#000000");
    if (result.method.includes("maxWidth"))
      expect(result.rightmost, result.method).toBeLessThanOrEqual(31);
  }
});

test("Sheets のドメイン除外を保存するとセルと本文が元へ戻り、解除後は再び読める", async ({
  page,
  extensionContext,
  extensionId,
}) => {
  await routeSheetsFixture(page);
  const options = await extensionContext.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel("除外するドメイン").fill("google.com");
  await options.getByRole("button", { name: "設定を保存" }).click();
  await expect(options.getByRole("status")).toContainText("設定を保存しました");
  await page.goto(sheetsUrl);
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await page.getByRole("button", { name: "セルを再描画" }).click();
  expect(await canvasPixel(page, "#cells", 10, 10)).toEqual([
    255, 255, 255, 255,
  ]);
  await options.getByLabel("除外するドメイン").fill("");
  await options.getByRole("button", { name: "設定を保存" }).click();
  await expect(options.getByRole("status")).toContainText("設定を保存しました");
  await page.reload();
  await expectReadableDark(page.locator("body"));
  await page.getByRole("button", { name: "セルを再描画" }).click();
  const pixel = await canvasPixel(page, "#cells", 10, 10);
  expect(pixel[3]).toBe(255);
  expect(relativeLuminance([pixel[0]!, pixel[1]!, pixel[2]!])).toBeLessThan(
    0.1,
  );
});
