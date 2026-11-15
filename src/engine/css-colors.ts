import type { Color, ColorRole } from "./color";
import { remapColor, serializeColor } from "./color";

export function createColorParser(): (source: string) => Color | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const cache = new Map<string, Color | null>();
  return (source) => {
    const cached = cache.get(source);
    if (cached !== undefined) return cached;
    let color: Color | null = null;
    if (
      CSS.supports("color", source) &&
      ![
        "currentcolor",
        "inherit",
        "initial",
        "unset",
        "revert",
        "revert-layer",
      ].includes(source.toLowerCase())
    ) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = source;
      context.fillRect(0, 0, 1, 1);
      const pixels = context.getImageData(0, 0, 1, 1).data;
      color = {
        r: pixels[0]!,
        g: pixels[1]!,
        b: pixels[2]!,
        a: pixels[3]! / 255,
      };
    }
    // SPA の色生成でも、ページの寿命に比例してキャッシュを増やさない。
    if (cache.size >= 4096) cache.clear();
    cache.set(source, color);
    return color;
  };
}

// URL の中身を色として扱わず、入れ子の color() や oklch() も一単位で読む。
export function remapCssColors(
  source: string,
  role: ColorRole,
  parse: (source: string) => Color | null,
): string {
  let result = "";
  let position = 0;
  while (position < source.length) {
    const rest = source.slice(position);
    const token = /^(#[\da-f]+|[a-z][a-z\d-]*)/i.exec(rest)?.[0];
    if (!token) {
      result += source[position];
      position++;
      continue;
    }
    let end = position + token.length;
    if (source[end] === "(") {
      let depth = 1;
      end++;
      let quote = "";
      while (end < source.length && depth > 0) {
        const char = source[end];
        if (char === "\\") {
          end += 2;
          continue;
        }
        if (quote) {
          if (char === quote) quote = "";
        } else if (char === '"' || char === "'") quote = char;
        else if (char === "(") depth++;
        else if (char === ")") depth--;
        end++;
      }
    }
    const candidate = source.slice(position, end);
    const color = token.toLowerCase() === "url" ? null : parse(candidate);
    if (color) result += serializeColor(remapColor(color, role));
    else if (/^(?:repeating-)?(?:linear|radial|conic)-gradient$/i.test(token)) {
      result += `${token}(${remapCssColors(candidate.slice(token.length + 1, -1), role, parse)})`;
    } else result += candidate;
    position = end;
  }
  return result;
}
