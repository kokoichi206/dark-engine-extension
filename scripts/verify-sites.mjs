import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import {
  contrastRatio,
  overOpaque,
  readCssRgba,
  relativeLuminance,
} from "../tests/support/visual-contract.ts";

async function bodyAppearance(page) {
  const css = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    root: getComputedStyle(document.documentElement).backgroundColor,
    text: getComputedStyle(document.body).color,
  }));
  const background = overOpaque(
    readCssRgba(css.background),
    overOpaque(readCssRgba(css.root), [255, 255, 255]),
  );
  const foreground = overOpaque(readCssRgba(css.text), background);
  return {
    background,
    foreground,
    luminance: relativeLuminance(background),
    contrast: contrastRatio(foreground, background),
  };
}

async function canvasSignature(canvas) {
  return canvas.evaluate((element) => {
    const bytes = element
      .getContext("2d")
      .getImageData(0, 0, element.width, element.height).data;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return (hash >>> 0).toString(16);
  });
}

const extensionPath = resolve("dist");
const output = "docs/verification";
await mkdir(output, { recursive: true });
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: !process.env.HEADED,
  viewport: { width: 1440, height: 1000 },
  colorScheme: "light",
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
const results = [];
try {
  const extensions = await context.newPage();
  await extensions.goto("chrome://extensions");
  const id = await extensions.locator("extensions-item").getAttribute("id");
  if (!id) throw new Error("拡張を読み込めませんでした。");
  await extensions.close();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(
    () => !document.querySelector("#enabled").disabled,
  );
  const targets = [
    {
      name: "sheets",
      url: "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
    },
    {
      name: "github",
      url: "https://github.com/kokoichi206/dark-engine-extension",
    },
    { name: "wikipedia", url: "https://en.wikipedia.org/wiki/Color" },
    { name: "example", url: "https://example.com/" },
  ];
  for (const target of targets) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const result = { ...target, errors };
    try {
      for (const enabled of [false, true]) {
        await popup.evaluate(
          (value) => chrome.storage.local.set({ enabled: value }),
          enabled,
        );
        const response = await page.goto(target.url, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        const brightness = expect.poll(
          async () => (await bodyAppearance(page)).luminance,
        );
        if (enabled) await brightness.toBeLessThan(0.1);
        else await brightness.toBeGreaterThan(0.5);
        if (target.name === "sheets")
          await page.locator("canvas").first().waitFor({ timeout: 45_000 });
        await page.waitForTimeout(target.name === "sheets" ? 5000 : 1800);
        const mode = enabled ? "dark" : "light";
        result[mode] = await page.evaluate(() => {
          const rect = (element) => {
            const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          return {
            title: document.title,
            url: location.href,
            body: {
              background: getComputedStyle(document.body).backgroundColor,
              color: getComputedStyle(document.body).color,
            },
            elements: document.querySelectorAll("*").length,
            renderDurationMs: performance
              .getEntriesByName("dark-engine:render")
              .at(-1)?.duration,
            filters: [
              getComputedStyle(document.documentElement).filter,
              getComputedStyle(document.body).filter,
            ],
            canvases: Array.from(document.querySelectorAll("canvas"))
              .map((canvas) => {
                const ctx = canvas.getContext("2d");
                const box = rect(canvas);
                let samples = [];
                if (ctx) {
                  try {
                    for (const [x, y] of [
                      [10, 10],
                      [100, 100],
                      [200, 100],
                      [400, 100],
                    ]) {
                      if (x < canvas.width && y < canvas.height)
                        samples.push({
                          x,
                          y,
                          color: Array.from(ctx.getImageData(x, y, 1, 1).data),
                        });
                    }
                  } catch (error) {
                    samples = [{ error: String(error) }];
                  }
                }
                return {
                  class: canvas.className,
                  width: canvas.width,
                  height: canvas.height,
                  parent: canvas.parentElement?.outerHTML.slice(0, 600),
                  box,
                  samples,
                };
              })
              .slice(0, 20),
          };
        });
        result[mode].httpStatus = response?.status();
        result[mode].appearance = await bodyAppearance(page);
        assert.equal(response?.status(), 200, `${target.name}: HTTP 200`);
        assert.equal(
          result[mode].filters.join(","),
          "none,none",
          "反転フィルターを使用しない",
        );
        if (enabled) {
          assert.ok(
            result[mode].appearance.contrast >= 4.5,
            "本文と背景のコントラストを保つ",
          );
          if (target.name === "sheets") {
            const canvas = result[mode].canvases.find(
              (canvas) => canvas.width > 500,
            );
            const cell = canvas?.samples.find(
              (sample) => sample.x === 100 && sample.y === 100,
            );
            assert.ok(
              cell?.color?.[3] === 255 && relativeLuminance(cell.color) < 0.1,
              "セルの描画ピクセルを暗くする",
            );
          }
        }
        await page.screenshot({ path: `${output}/${target.name}-${mode}.png` });
        if (target.name === "github" && enabled) {
          await page.bringToFront();
          await popup.reload();
          await expect(popup.locator("#current-domain")).toHaveText(
            "github.com",
          );
          await popup.locator("body").screenshot({
            path: `${output}/popup.png`,
            animations: "disabled",
          });
        }
        console.log(
          JSON.stringify({ site: target.name, mode, result: result[mode] }),
        );
      }
      if (target.name === "sheets") {
        const grid = page.locator(".grid-container").first();
        await expect(grid).toBeVisible();
        await grid.click({ position: { x: 160, y: 80 } });
        const nameBox = page.locator("#t-name-box");
        const selectionBefore = await nameBox.inputValue();
        await page.keyboard.press("ArrowDown");
        await expect(nameBox).not.toHaveValue(selectionBefore);
        const selectionAfter = await nameBox.inputValue();
        const canvas = page.locator("canvas").first();
        const beforeScroll = await canvasSignature(canvas);
        await page.mouse.wheel(0, 700);
        await expect.poll(() => canvasSignature(canvas)).not.toBe(beforeScroll);
        result.interaction = {
          selectionBefore,
          selectionAfter,
          canvasBeforeScroll: beforeScroll,
          canvasAfterScroll: await canvasSignature(canvas),
        };
        await page.screenshot({ path: `${output}/sheets-scrolled.png` });
        result.dom = await page.evaluate(() =>
          Array.from(document.querySelectorAll("canvas")).map((canvas) =>
            canvas.parentElement?.outerHTML.slice(0, 1500),
          ),
        );
      }
    } catch (error) {
      result.failure = String(error);
      await page
        .screenshot({ path: `${output}/${target.name}-failure.png` })
        .catch(() => {});
      console.error(`${target.name}: ${error}`);
    }
    results.push(result);
    await writeFile(
      `${output}/results.json`,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          browser: context.browser()?.version(),
          results,
        },
        null,
        2,
      ) + "\n",
    );
    await page.close();
  }
} finally {
  await context.close();
}
if (results.some((result) => result.failure)) process.exitCode = 1;
