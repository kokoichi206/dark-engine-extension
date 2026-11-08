import { describe, expect, it } from "vitest";
import {
  readableForeground,
  remapColor,
  composite,
  type Color,
} from "../src/engine/color";
import {
  contrastRatio,
  relativeLuminance,
  type Rgb,
} from "./support/visual-contract";

const color = ([r, g, b]: Rgb, a = 1): Color => ({ r, g, b, a });
const channels = ({ r, g, b }: Color): Rgb => [r, g, b];

describe("利用者に見える配色の条件", () => {
  it("半透明の面を背景と合成するとき、既知の混色結果と不透明度を保つ", () => {
    // 合成を誤ると実際の背景と分析結果がずれるため、再マップの結果ではなく既知の混色を照合する。
    const red = color([255, 0, 0]);
    const blue = color([0, 0, 255]);
    expect(composite({ ...red, a: 0.5 }, blue)).toEqual(
      color([127.5, 0, 127.5]),
    );
    expect(composite({ ...red, a: 0 }, blue)).toEqual(blue);
    expect(composite(red, { ...blue, a: 0.5 })).toEqual(red);
  });
  it("白・薄い赤・薄い青の面を暗くする", () => {
    for (const source of [
      [255, 255, 255],
      [255, 224, 221],
      [229, 239, 255],
    ] satisfies Rgb[]) {
      expect(
        relativeLuminance(channels(remapColor(color(source), "background"))),
      ).toBeLessThan(0.1);
    }
  });
  it("すでに暗い背景を、反転や繰り返し変換で変色させない", () => {
    for (const source of [
      [0, 0, 0],
      [22, 27, 34],
      [20, 20, 20],
    ] satisfies Rgb[]) {
      const original = color(source);
      expect(remapColor(original, "background")).toEqual(original);
    }
  });
  it("背景を透過・半透過にしているページの不透明度を変えない", () => {
    for (const alpha of [0, 0.25, 0.5, 1]) {
      expect(remapColor(color([200, 40, 30], alpha), "background").a).toBe(
        alpha,
      );
    }
  });
  it("原色と薄い色の赤・緑・青を取り違えたり無彩色に潰したりしない", () => {
    for (const [source, dominant] of [
      [[255, 0, 0], 0],
      [[0, 180, 0], 1],
      [[0, 0, 255], 2],
      [[255, 224, 221], 0],
      [[220, 255, 220], 1],
      [[229, 239, 255], 2],
    ] satisfies Array<readonly [Rgb, number]>) {
      for (const role of ["foreground", "background"] as const) {
        const mapped = channels(remapColor(color(source), role));
        for (const channel of mapped) {
          expect(Number.isFinite(channel)).toBe(true);
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
        expect(mapped[dominant]).toBeGreaterThan(
          Math.max(...mapped.filter((_, index) => index !== dominant)),
        );
      }
    }
  });
  it("不透明な本文色を、独立した WCAG の判定で 4.5:1 以上にする", () => {
    const sources: Rgb[] = [
      [0, 0, 0],
      [70, 70, 70],
      [0, 0, 255],
      [255, 0, 0],
      [0, 180, 0],
      [120, 20, 180],
    ];
    // 明るめの暗色面も含め、明度の追加調整を省いた実装では失敗する条件を作る。
    const backgrounds: Rgb[] = [
      [33, 40, 48],
      [90, 100, 110],
    ];
    for (const source of sources)
      for (const background of backgrounds) {
        const foreground = readableForeground(color(source), color(background));
        expect(
          contrastRatio(channels(foreground), background),
          `${source} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
  });
});
