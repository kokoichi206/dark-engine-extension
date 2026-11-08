import {
  composite,
  palette,
  readableForeground,
  remapColor,
  serializeColor,
  type Color,
  type ColorRole,
} from "./color";
import { createColorParser, remapCssColors } from "./css-colors";

type StyleRoot = Document | ShadowRoot;
type RootSheet = { readonly root: StyleRoot; readonly sheet: CSSStyleSheet };
const MARKER = "data-dark-engine-node";
const excluded = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "HEAD",
  "TITLE",
  "NOSCRIPT",
  "TEMPLATE",
]);
const colorProperties: ReadonlyArray<readonly [string, ColorRole]> = [
  ["background-color", "background"],
  ["color", "foreground"],
  ["border-top-color", "border"],
  ["border-right-color", "border"],
  ["border-bottom-color", "border"],
  ["border-left-color", "border"],
  ["outline-color", "border"],
  ["text-decoration-color", "foreground"],
  ["caret-color", "foreground"],
  ["column-rule-color", "border"],
  ["-webkit-text-fill-color", "foreground"],
  ["-webkit-text-stroke-color", "foreground"],
  ["fill", "foreground"],
  ["stroke", "foreground"],
  ["accent-color", "foreground"],
];

export function startDomEngine(): void {
  const parse = createColorParser();
  let rootSheets: RootSheet[] = [];
  const nodeIds = new WeakMap<Element, number>();
  const mappedColors = new Map<string, string>();
  let nextId = 0;
  let scheduled = false;
  let lastRender = 0;
  let stylesheetSignature = "";
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (mutation) =>
          mutation.type !== "attributes" ||
          mutation.attributeName !== "data-dark-engine-enabled",
      )
    )
      schedule();
  });

  function addRoot(root: StyleRoot): RootSheet {
    const existing = rootSheets.find((entry) => entry.root === root);
    if (existing) return existing;
    const sheet = new CSSStyleSheet();
    sheet.disabled = true;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    const entry = { root, sheet };
    rootSheets.push(entry);
    return entry;
  }

  function declarations(
    style: CSSStyleDeclaration,
    background: Color,
    element: Element,
  ): string {
    const rules: string[] = [];
    for (const [property, role] of colorProperties) {
      const value = style.getPropertyValue(property);
      if (!value || value === "none" || value === "auto") continue;
      if (
        (property === "fill" || property === "stroke") &&
        !(element instanceof SVGElement)
      )
        continue;
      if (
        property.startsWith("border-") &&
        style.getPropertyValue(property.replace("color", "style")) === "none"
      )
        continue;
      if (property === "outline-color" && style.outlineStyle === "none")
        continue;
      if (property === "column-rule-color" && style.columnRuleStyle === "none")
        continue;
      if (
        property === "text-decoration-color" &&
        style.textDecorationLine === "none"
      )
        continue;
      if (property === "-webkit-text-fill-color" && value === style.color)
        continue;
      if (
        property === "-webkit-text-stroke-color" &&
        style.getPropertyValue("-webkit-text-stroke-width") === "0px"
      )
        continue;
      const color = parse(value);
      if (!color || color.a === 0) continue;
      const actualRole =
        property === "fill" && ["rect", "polygon"].includes(element.localName)
          ? "background"
          : role;
      const key = `${actualRole}:${value}:${actualRole === "foreground" ? serializeColor(background) : ""}`;
      let mapped = mappedColors.get(key);
      if (!mapped) {
        mapped = serializeColor(
          actualRole === "foreground"
            ? readableForeground(color, background)
            : remapColor(color, actualRole),
        );
        if (mappedColors.size >= 4096) mappedColors.clear();
        mappedColors.set(key, mapped);
      }
      rules.push(`${property}:${mapped}!important`);
    }
    for (const [property, role] of [
      ["background-image", "background"],
      ["box-shadow", "border"],
      ["text-shadow", "border"],
    ] satisfies ReadonlyArray<readonly [string, ColorRole]>) {
      const original = style.getPropertyValue(property);
      if (!original || original === "none") continue;
      const mapped = remapCssColors(original, role, parse);
      if (mapped !== original) rules.push(`${property}:${mapped}!important`);
    }
    return rules.join(";");
  }

  function render(): void {
    scheduled = false;
    if (document.hidden) return;
    lastRender = performance.now();
    observer.disconnect();
    // 変換後の色を再入力にしないよう、読み取り中だけ自分のシートを外す。描画前に同じタスク内で戻す。
    for (const { root, sheet } of rootSheets) {
      if (!root.adoptedStyleSheets.includes(sheet))
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      sheet.disabled = true;
    }
    const backgrounds = new WeakMap<Element, Color>();
    const renderedRoots = new Set<StyleRoot>();
    function scan(
      { root, sheet }: RootSheet,
      inheritedBackground: Color,
    ): void {
      renderedRoots.add(root);
      const rules: string[] =
        root instanceof Document
          ? [
              `:root{color-scheme:dark!important;background-color:${serializeColor(palette.background)}!important;color:${serializeColor(palette.foreground)}!important}`,
              `::selection{background-color:#31577d!important;color:#edf3fa!important}`,
            ]
          : [":host{color-scheme:dark}"];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          if (!(node instanceof Element)) return NodeFilter.FILTER_SKIP;
          // 非表示のメニューなどは、表示時の属性変更で変換する。
          return excluded.has(node.tagName) ||
            getComputedStyle(node).display === "none"
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node instanceof Element)) continue;
        const element = node;
        const style = getComputedStyle(element);
        const parent = element.parentElement;
        const parentBackground =
          (parent && backgrounds.get(parent)) || inheritedBackground;
        const originalBackground = parse(style.backgroundColor);
        const background = originalBackground
          ? composite(
              remapColor(originalBackground, "background"),
              parentBackground,
            )
          : parentBackground;
        backgrounds.set(element, background);
        let id = nodeIds.get(element);
        if (id === undefined) {
          id = nextId++;
          nodeIds.set(element, id);
        }
        if (element.getAttribute(MARKER) !== String(id))
          element.setAttribute(MARKER, String(id));
        // ID 相当の詳細度で作者の通常ルールを上書きし、元の inline style は変更しない。
        const selector = `:is(#dark-engine-specificity,[${MARKER}="${id}"])`;
        const declaration = declarations(style, background, element);
        if (declaration) rules.push(`${selector}{${declaration}}`);
        for (const pseudo of ["::before", "::after", "::placeholder"]) {
          if (
            pseudo === "::placeholder" &&
            !["INPUT", "TEXTAREA"].includes(element.tagName)
          )
            continue;
          const pseudoStyle = getComputedStyle(element, pseudo);
          if (
            pseudo !== "::placeholder" &&
            (pseudoStyle.content === "none" || pseudoStyle.content === "normal")
          )
            continue;
          const pseudoBackground = parse(pseudoStyle.backgroundColor);
          const effectiveBackground = pseudoBackground
            ? composite(remapColor(pseudoBackground, "background"), background)
            : background;
          const pseudoDeclaration = declarations(
            pseudoStyle,
            effectiveBackground,
            element,
          );
          if (pseudoDeclaration)
            rules.push(`${selector}${pseudo}{${pseudoDeclaration}}`);
        }
        if (element.shadowRoot) {
          scan(addRoot(element.shadowRoot), background);
        }
      }
      sheet.replaceSync(rules.join("\n"));
    }
    scan(addRoot(document), palette.background);
    rootSheets = rootSheets.filter((entry) => {
      if (!renderedRoots.has(entry.root)) {
        entry.root.adoptedStyleSheets = entry.root.adoptedStyleSheets.filter(
          (sheet) => sheet !== entry.sheet,
        );
        return false;
      } else {
        entry.sheet.disabled = false;
        observer.observe(entry.root, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
      }
      return true;
    });
    performance.clearMeasures("dark-engine:render");
    performance.measure("dark-engine:render", {
      start: lastRender,
      end: performance.now(),
    });
  }

  function schedule(): void {
    if (scheduled || document.hidden) return;
    scheduled = true;
    // DOM 更新が続く SPA でも、毎フレームの全走査を避ける。
    setTimeout(
      () => requestAnimationFrame(render),
      Math.max(0, 150 - (performance.now() - lastRender)),
    );
  }

  addRoot(document);
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  for (const event of [
    "pointerover",
    "pointerout",
    "focusin",
    "focusout",
    "input",
    "change",
    "load",
    "transitionend",
    "animationend",
  ]) {
    document.addEventListener(event, schedule, {
      capture: true,
      passive: true,
    });
  }
  window.addEventListener("resize", schedule, { passive: true });
  document.addEventListener("visibilitychange", schedule);
  // CSSOM の insertRule と既存ホストへの attachShadow は MutationObserver の対象外。
  setInterval(() => {
    if (document.hidden) return;
    const signature = rootSheets
      .map(({ root, sheet: own }) => {
        const sheets = [...root.styleSheets, ...root.adoptedStyleSheets].filter(
          (sheet) => sheet !== own,
        );
        return sheets
          .map((sheet) => {
            try {
              return `${sheet.disabled}:${Array.from(sheet.cssRules, (rule) => rule.cssText).join("")}`;
            } catch (error) {
              // クロスオリジンの CSSOM はブラウザに拒否される。色は getComputedStyle から取得する。
              if (
                error instanceof DOMException &&
                error.name === "SecurityError"
              )
                return sheet.href;
              throw error;
            }
          })
          .join("|");
      })
      .join("\n");
    const newShadow = Array.from(document.querySelectorAll("*")).some(
      (element) =>
        element.shadowRoot &&
        !rootSheets.some((entry) => entry.root === element.shadowRoot),
    );
    if (signature !== stylesheetSignature || newShadow) {
      stylesheetSignature = signature;
      schedule();
    }
  }, 1500);
  schedule();
}
