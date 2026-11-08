export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

// 判定は WCAG 2.2 の相対輝度とコントラスト比に基づき、本番の色変換コードを参照しない。
export function relativeLuminance([red, green, blue]: Rgb | Rgba): number {
  const linearize = (channel: number): number => {
    const srgb = channel / 255;
    return srgb > 0.04045
      ? Math.pow((srgb + 0.055) / 1.055, 2.4)
      : srgb / 12.92;
  };
  return (
    linearize(red) * 0.2126 +
    linearize(green) * 0.7152 +
    linearize(blue) * 0.0722
  );
}

export function contrastRatio(first: Rgb | Rgba, second: Rgb | Rgba): number {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

export function readCssRgba(css: string): Rgba {
  const match = /^rgba?\(([^)]+)\)$/.exec(css);
  if (!match)
    throw new Error(`ブラウザから RGB 色を取得できませんでした: ${css}`);
  const channels = match[1]!.split(",").map(Number);
  return [channels[0]!, channels[1]!, channels[2]!, channels[3] ?? 1];
}

export function overOpaque([r, g, b, alpha]: Rgba, background: Rgb): Rgb {
  return [
    r * alpha + background[0] * (1 - alpha),
    g * alpha + background[1] * (1 - alpha),
    b * alpha + background[2] * (1 - alpha),
  ];
}
