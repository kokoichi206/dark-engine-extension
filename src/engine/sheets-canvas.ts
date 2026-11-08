import {
  palette,
  readableForeground,
  remapColor,
  serializeColor,
} from "./color";
import { createColorParser } from "./css-colors";

export function installSheetsCanvas(): void {
  const parse = createColorParser();
  const prototype = CanvasRenderingContext2D.prototype;
  const fillRect = prototype.fillRect;
  const fill = prototype.fill;
  const stroke = prototype.stroke;
  const strokeRect = prototype.strokeRect;
  const fillText = prototype.fillText;
  const strokeText = prototype.strokeText;

  function enabled(context: CanvasRenderingContext2D): boolean {
    // 写真・グラフの画像や、他サイトの Canvas にグローバルな反転をかけない。
    return (
      document.documentElement?.getAttribute("data-dark-engine-enabled") ===
        "on" &&
      context.canvas instanceof HTMLCanvasElement &&
      context.canvas.closest(
        ".kix-appview-editor, .waffle, .grid-container, .kix-spreadsheet-editor",
      ) !== null
    );
  }

  function mappedStyle(
    context: CanvasRenderingContext2D,
    style: string | CanvasGradient | CanvasPattern,
    role: "background" | "foreground" | "border",
  ): string | CanvasGradient | CanvasPattern {
    if (!enabled(context) || typeof style !== "string") return style;
    const color = parse(style);
    if (!color) return style;
    return serializeColor(
      role === "foreground"
        ? readableForeground(color, palette.background)
        : remapColor(color, role),
    );
  }

  // 描画の直前だけ置き換えるため、save/restore と fillStyle の読み戻しはサイト本来の値を保つ。
  prototype.fillRect = function (...args: Parameters<typeof fillRect>): void {
    const original = this.fillStyle;
    this.fillStyle = mappedStyle(this, original, "background");
    try {
      fillRect.apply(this, args);
    } finally {
      this.fillStyle = original;
    }
  };
  prototype.fill = function (
    ...args:
      | [fillRule?: CanvasFillRule | undefined]
      | [path: Path2D, fillRule?: CanvasFillRule | undefined]
  ): void {
    const original = this.fillStyle;
    this.fillStyle = mappedStyle(this, original, "background");
    try {
      Reflect.apply(fill, this, args);
    } finally {
      this.fillStyle = original;
    }
  };
  prototype.strokeRect = function (
    ...args: Parameters<typeof strokeRect>
  ): void {
    const original = this.strokeStyle;
    this.strokeStyle = mappedStyle(this, original, "border");
    try {
      strokeRect.apply(this, args);
    } finally {
      this.strokeStyle = original;
    }
  };
  prototype.stroke = function (...args: [path?: Path2D | undefined]): void {
    const original = this.strokeStyle;
    this.strokeStyle = mappedStyle(this, original, "border");
    try {
      Reflect.apply(stroke, this, args);
    } finally {
      this.strokeStyle = original;
    }
  };
  prototype.fillText = function (...args: Parameters<typeof fillText>): void {
    const original = this.fillStyle;
    this.fillStyle = mappedStyle(this, original, "foreground");
    try {
      fillText.apply(this, args);
    } finally {
      this.fillStyle = original;
    }
  };
  prototype.strokeText = function (
    ...args: Parameters<typeof strokeText>
  ): void {
    const original = this.strokeStyle;
    this.strokeStyle = mappedStyle(this, original, "foreground");
    try {
      strokeText.apply(this, args);
    } finally {
      this.strokeStyle = original;
    }
  };
}
