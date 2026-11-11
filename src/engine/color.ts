export type Color = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};
export type ColorRole = "background" | "foreground" | "border";

export const palette = {
  background: { r: 33, g: 40, b: 48, a: 1 },
  foreground: { r: 209, g: 215, b: 224, a: 1 },
  border: { r: 61, g: 68, b: 77, a: 1 },
} satisfies Record<ColorRole, Color>;

const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));
const linear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const gamma = (value: number): number =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

export function luminance(color: Color): number {
  return (
    0.2126 * linear(color.r / 255) +
    0.7152 * linear(color.g / 255) +
    0.0722 * linear(color.b / 255)
  );
}

export function composite(front: Color, back: Color): Color {
  const a = front.a + back.a * (1 - front.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (front.r * front.a + back.r * back.a * (1 - front.a)) / a,
    g: (front.g * front.a + back.g * back.a * (1 - front.a)) / a,
    b: (front.b * front.a + back.b * back.a * (1 - front.a)) / a,
    a,
  };
}

export function contrast(first: Color, second: Color): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function toOklab(color: Color): readonly [number, number, number] {
  const r = linear(color.r / 255);
  const g = linear(color.g / 255);
  const b = linear(color.b / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(
  lightness: number,
  a: number,
  b: number,
  alpha: number,
): Color {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: 255 * gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: 255 * gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: 255 * gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

// 色域外の RGB を切り捨てると色相がずれるため、明度と色相を保って彩度を落とす。
function inGamut(
  lightness: number,
  a: number,
  b: number,
  alpha: number,
): Color {
  let low = 0;
  let high = 1;
  let result = fromOklab(lightness, 0, 0, alpha);
  for (let i = 0; i < 12; i++) {
    const scale = (low + high) / 2;
    const candidate = fromOklab(lightness, a * scale, b * scale, alpha);
    if (
      [candidate.r, candidate.g, candidate.b].every(
        (channel) => channel >= 0 && channel <= 255,
      )
    ) {
      low = scale;
      result = candidate;
    } else high = scale;
  }
  return result;
}

export function remapColor(color: Color, role: ColorRole): Color {
  if (color.a === 0) return color;
  const [lightness, a, b] = toOklab(color);
  const chroma = Math.hypot(a, b);
  if (chroma < 0.015) {
    if (role === "foreground") {
      const shade = 0.8 + 0.2 * (1 - lightness);
      return {
        r: palette.foreground.r * shade,
        g: palette.foreground.g * shade,
        b: palette.foreground.b * shade,
        a: color.a,
      };
    }
    if (role === "border") return { ...palette.border, a: color.a };
    // 暗い面は保ち、白い面は基準色へ寄せて階層の差を残す。
    if (lightness < 0.4) return color;
    const lift = (1 - lightness) * 24;
    return {
      r: palette.background.r + lift,
      g: palette.background.g + lift,
      b: palette.background.b + lift,
      a: color.a,
    };
  }
  if (role === "background" && lightness < 0.4) return color;
  const target =
    role === "background"
      ? 0.3 + 0.12 * (1 - lightness)
      : role === "border"
        ? 0.46
        : Math.max(0.76, Math.min(lightness, 0.86));
  const chromaScale =
    role === "background" ? 0.55 : role === "border" ? 0.65 : 0.85;
  return inGamut(target, a * chromaScale, b * chromaScale, color.a);
}

export function readableForeground(color: Color, background: Color): Color {
  let mapped = remapColor(color, "foreground");
  if (
    color.a === 0 ||
    contrast(composite(mapped, background), background) >= 4.5
  )
    return mapped;
  const [, a, b] = toOklab(mapped);
  for (let lightness = 0.78; lightness <= 1; lightness += 0.02) {
    mapped = inGamut(lightness, a, b, color.a);
    if (contrast(composite(mapped, background), background) >= 4.5) break;
  }
  return mapped;
}

export function serializeColor(color: Color): string {
  return `rgba(${Math.round(clamp(color.r, 0, 255))}, ${Math.round(clamp(color.g, 0, 255))}, ${Math.round(clamp(color.b, 0, 255))}, ${Number(color.a.toFixed(3))})`;
}
