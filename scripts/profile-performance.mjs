import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { performance as nodePerformance } from "node:perf_hooks";

const output = resolve(
  process.argv
    .find((argument) => argument.startsWith("--output="))
    ?.slice("--output=".length) ?? "test-results/performance",
);
const projectRoot = resolve(
  process.argv
    .find((argument) => argument.startsWith("--project="))
    ?.slice("--project=".length) ?? ".",
);
const extensionPath = resolve(projectRoot, "dist");
const quick = process.argv.includes("--quick");
const live = process.argv.includes("--live");
const serveOnly = process.argv.includes("--serve");
const largeOnly = process.argv.includes("--large");
const diagnose = process.argv.includes("--diagnose");
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const html = (
  cards,
) => `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>Dark Engine 負荷の再現ページ</title><style>
body{font:15px/1.5 system-ui;background:#fff;color:#111;margin:0}header{padding:16px 24px;position:sticky;top:0;background:#f5f5f5;border-bottom:1px solid #ddd;z-index:1}input{font:inherit;margin:0 20px;padding:8px;background:#fff;color:#111;border:1px solid #bbb}.cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px}.card{background:#f7f7f7;border:1px solid #ddd;padding:12px}.card:hover{background:#ddeeff}p{margin:6px 0}a{color:#0645ad}button{background:#fff;color:#222;border:1px solid #aaa;padding:5px}
</style></head><body><header><strong>負荷の再現ページ</strong><label>文字入力<input aria-label="文字入力"></label><output id="typed">0</output> 文字 / 更新 <output id="counter">0</output></header><main class="cards">${Array.from({ length: cards }, (_, i) => `<article class="card"><strong>項目 ${i + 1}</strong><p>表示内容のサンプル <a href="#item-${i}">詳細を見る</a></p><button>開く</button></article>`).join("")}</main><script>document.querySelector('input').addEventListener('input',event=>{document.querySelector('#typed').textContent=String(event.target.value.length)});</script></body></html>`;
const server = createServer((req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  const count = Number(
    new URL(req.url, "http://127.0.0.1:4175").searchParams.get("cards") ?? 600,
  );
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    res.writeHead(400);
    res.end("cards must be between 1 and 1000");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html(count));
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(4175, "127.0.0.1", done);
});
console.log("Fixture: http://127.0.0.1:4175/?cards=600");
if (serveOnly) await new Promise(() => {});
await mkdir(output, { recursive: true });
const hashes = {};
for (const path of [
  "src/engine/dom-engine.ts",
  "src/engine/sheets-canvas.ts",
  "dist/content.js",
  "dist/sheets.js",
])
  hashes[path] = createHash("sha256")
    .update(await readFile(resolve(projectRoot, path)))
    .digest("hex");
const reportFile = resolve(
  output,
  live
    ? "live-results.json"
    : quick
      ? "quick-results.json"
      : largeOnly
        ? "large-results.json"
        : "results.json",
);
const report = {
  date: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  headless: true,
  projectRoot,
  hashes,
  notes: [
    "一時プロファイル、測定は直列。ブラウザの可視状態を確認。",
    "TaskDuration は DevTools のメインスレッド・タスク時間。PC 全体の CPU 使用率ではない。",
    "INP そのものではなく、同一操作列の時間・フレーム間隔・Long Task を測定。",
  ],
  trials: [],
};

const initProbe = () => {
  const probe = {
    measures: [],
    longTasks: [],
    frames: [],
    delays: [],
    events: [],
  };
  window.__darkEnginePerformanceProbe = probe;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (entry.name === "dark-engine:render")
        probe.measures.push({
          start: entry.startTime,
          duration: entry.duration,
        });
  }).observe({ type: "measure", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      probe.longTasks.push({
        start: entry.startTime,
        duration: entry.duration,
      });
  }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      probe.events.push({
        start: entry.startTime,
        name: entry.name,
        duration: entry.duration,
        delay: entry.processingStart - entry.startTime,
      });
  }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  let previousFrame = performance.now();
  const frame = (now) => {
    probe.frames.push({ start: now, duration: now - previousFrame });
    previousFrame = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  let previousTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    probe.delays.push({
      start: now,
      duration: Math.max(0, now - previousTick - 50),
    });
    previousTick = now;
  }, 50);
};
const quantile = (values, q) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
    : 0;
};
const stats = (values) => ({
  count: values.length,
  sum: values.reduce((a, b) => a + b, 0),
  median: quantile(values, 0.5),
  p95: quantile(values, 0.95),
  max: quantile(values, 1),
});
const metrics = async (client) =>
  Object.fromEntries(
    (await client.send("Performance.getMetrics")).metrics.map(
      ({ name, value }) => [name, value],
    ),
  );
async function measure(page, client, name, operation) {
  const start = await page.evaluate(() => performance.now());
  const before = await metrics(client);
  const nodeStart = nodePerformance.now();
  await operation();
  const operationMs = nodePerformance.now() - nodeStart;
  const after = await metrics(client);
  const end = await page.evaluate(() => performance.now());
  const entries = await page.evaluate(
    ({ start, end }) =>
      Object.fromEntries(
        Object.entries(window.__darkEnginePerformanceProbe).map(
          ([name, list]) => [
            name,
            list.filter((entry) => entry.start >= start && entry.start < end),
          ],
        ),
      ),
    { start, end },
  );
  const delta = {};
  for (const key of [
    "TaskDuration",
    "ScriptDuration",
    "LayoutDuration",
    "RecalcStyleDuration",
  ])
    delta[key] = Math.max(0, (after[key] - before[key]) * 1000);
  return {
    name,
    elapsedMs: end - start,
    operationMs,
    mainThreadMs: delta.TaskDuration,
    scriptMs: delta.ScriptDuration,
    layoutMs: delta.LayoutDuration,
    styleMs: delta.RecalcStyleDuration,
    render: stats(entries.measures.map((e) => e.duration)),
    longTasks: stats(entries.longTasks.map((e) => e.duration)),
    frames: stats(entries.frames.map((e) => e.duration)),
    timerDelay: stats(entries.delays.map((e) => e.duration)),
    eventDelay: stats(entries.events.map((e) => e.delay)),
    eventDurations: stats(entries.events.map((e) => e.duration)),
    heapBytes: after.JSHeapUsedSize,
  };
}
async function createContext(mode) {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
    args:
      mode === "absent"
        ? ["--disk-cache-size=1048576"]
        : [
            "--disk-cache-size=1048576",
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ],
  });
  let control;
  if (mode !== "absent") {
    const extensions = await context.newPage();
    await extensions.goto("chrome://extensions");
    const id = await extensions.locator("extensions-item").getAttribute("id");
    if (!id) throw new Error("Dark Engine を読み込めませんでした。");
    await extensions.close();
    control = await context.newPage();
    await control.goto(`chrome-extension://${id}/popup.html`);
    await control.evaluate(
      (enabled) => chrome.storage.local.set({ enabled, excludedDomains: [] }),
      mode === "on",
    );
  }
  await context.addInitScript(initProbe);
  return { context, control };
}
async function profileHover(page, client, file) {
  await client.send("Profiler.enable");
  await client.send("Profiler.start");
  for (let i = 0; i < 16; i++) {
    await page.mouse.move(i % 2 ? 500 : 100, 180 + (i % 4) * 110);
    await wait(100);
  }
  const { profile } = await client.send("Profiler.stop");
  await writeFile(file, JSON.stringify(profile));
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const samples = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const node = nodes.get(profile.samples[i]);
    const frame = node.callFrame;
    const key = `${frame.url}|${frame.functionName}|${frame.lineNumber}`;
    const item = samples.get(key) ?? {
      url: frame.url,
      functionName: frame.functionName,
      lineNumber: frame.lineNumber,
      microseconds: 0,
      samples: 0,
    };
    item.microseconds += profile.timeDeltas[i];
    item.samples++;
    samples.set(key, item);
  }
  return [...samples.values()]
    .toSorted((a, b) => b.microseconds - a.microseconds)
    .slice(0, 15);
}
async function localTrial(mode, cards, round) {
  const { context } = await createContext(mode);
  try {
    report.browser = context.browser().version();
    report.browser = context.browser().version();
    const page = await context.newPage();
    await page.bringToFront();
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    const url = `http://127.0.0.1:4175/?cards=${cards}`;
    const nav = nodePerformance.now();
    await page.goto(url, { waitUntil: "load" });
    if (mode === "on")
      await page.waitForFunction(
        () => performance.getEntriesByName("dark-engine:render").length > 0,
      );
    await wait(2200);
    const info = await page.evaluate(() => ({
      elements: document.querySelectorAll("*").length,
      visible: !document.hidden,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    if (!info.visible) throw new Error("測定ページが非表示です。");
    const trial = {
      mode,
      cards,
      round,
      url,
      ...info,
      startupMs: nodePerformance.now() - nav,
      phases: [],
    };
    trial.phases.push(await measure(page, client, "idle", () => wait(2200)));
    await wait(400);
    trial.phases.push(
      await measure(page, client, "hover", async () => {
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(i % 2 ? 500 : 100, 180 + (i % 4) * 110);
          await wait(100);
        }
      }),
    );
    await wait(400);
    trial.phases.push(
      await measure(page, client, "counter-10hz", async () => {
        await page.evaluate(() => {
          let tick = 0;
          window.__counterTimer = setInterval(
            () =>
              (document.querySelector("#counter").textContent = String(++tick)),
            100,
          );
        });
        await wait(2200);
        await page.evaluate(() => clearInterval(window.__counterTimer));
      }),
    );
    await wait(400);
    trial.phases.push(
      await measure(page, client, "typing", async () => {
        const input = page.getByRole("textbox", { name: "文字入力" });
        await input.click();
        await input.pressSequentially("abcdefghijklmnop", { delay: 100 });
      }),
    );
    if (mode === "on" && cards === 600 && round === 0) {
      trial.profile = await profileHover(
        page,
        client,
        resolve(output, "hover.cpuprofile"),
      );
      await client.send("Tracing.start", {
        categories: "devtools.timeline,blink.user_timing",
        transferMode: "ReturnAsStream",
      });
      for (let i = 0; i < 8; i++) {
        await page.mouse.move(i % 2 ? 500 : 100, 180 + (i % 4) * 110);
        await wait(100);
      }
      const complete = new Promise((done) =>
        client.once("Tracing.tracingComplete", done),
      );
      await client.send("Tracing.end");
      const { stream } = await complete;
      let trace = "";
      while (true) {
        const chunk = await client.send("IO.read", { handle: stream });
        trace += chunk.data;
        if (chunk.eof) break;
      }
      await client.send("IO.close", { handle: stream });
      await writeFile(resolve(output, "hover-trace.json"), trace);
      const events = JSON.parse(trace).traceEvents.filter(
        (event) => event.ph === "X" && event.dur,
      );
      const totals = new Map();
      for (const event of events) {
        const entry = totals.get(event.name) ?? {
          name: event.name,
          count: 0,
          milliseconds: 0,
          max: 0,
        };
        entry.count++;
        entry.milliseconds += event.dur / 1000;
        entry.max = Math.max(entry.max, event.dur / 1000);
        totals.set(event.name, entry);
      }
      trial.trace = [...totals.values()]
        .toSorted((a, b) => b.milliseconds - a.milliseconds)
        .slice(0, 20);
    }
    report.trials.push(trial);
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify({
        mode,
        cards,
        round,
        phases: trial.phases.map((p) => ({
          name: p.name,
          elapsed: Math.round(p.elapsedMs),
          task: Math.round(p.mainThreadMs),
          renders: p.render.count,
          renderMax: Math.round(p.render.max),
          longTasks: p.longTasks.count,
          frameP95: Math.round(p.frames.p95),
        })),
      }),
    );
  } finally {
    await context.close();
  }
}
async function liveTrial(mode, target) {
  const { context } = await createContext(mode);
  try {
    report.browser = context.browser().version();
    const page = await context.newPage();
    await page.bringToFront();
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    if (target.name === "sheets")
      await page.locator("canvas").first().waitFor({ timeout: 45000 });
    if (mode === "on")
      await page.waitForFunction(
        () => performance.getEntriesByName("dark-engine:render").length > 0,
      );
    await wait(4000);
    const info = await page.evaluate(() => ({
      elements: document.querySelectorAll("*").length,
      visible: !document.hidden,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    if (!info.visible) throw new Error("測定ページが非表示です。");
    const trial = {
      mode,
      site: target.name,
      url: target.url,
      ...info,
      phases: [],
    };
    trial.phases.push(await measure(page, client, "idle", () => wait(2500)));
    trial.phases.push(
      await measure(page, client, "hover", async () => {
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(200 + (i % 3) * 140, 180 + (i % 4) * 80);
          await wait(100);
        }
      }),
    );
    trial.phases.push(
      await measure(page, client, "scroll", async () => {
        for (let i = 0; i < 12; i++) {
          await page.mouse.wheel(0, i % 2 ? -240 : 240);
          await wait(140);
        }
      }),
    );
    trial.canvasCount = await page.locator("canvas").count();
    trial.title = await page.title();
    const screenshot = `${target.name}-${mode}-${report.trials.length}.png`;
    await page.screenshot({ path: resolve(output, screenshot) });
    trial.screenshot = screenshot;
    report.trials.push(trial);
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify({
        mode,
        site: target.name,
        phases: trial.phases.map((p) => ({
          name: p.name,
          elapsed: Math.round(p.elapsedMs),
          task: Math.round(p.mainThreadMs),
          renders: p.render.count,
          renderMax: Math.round(p.render.max),
          longTasks: p.longTasks.count,
          frameP95: Math.round(p.frames.p95),
        })),
      }),
    );
  } finally {
    await context.close();
  }
}
async function diagnoseIdle(mode, target) {
  const { context } = await createContext(mode);
  try {
    const page = await context.newPage();
    await page.bringToFront();
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    await page.goto(target.url, { waitUntil: "load" });
    await wait(4000);
    await page.evaluate(() => {
      window.__idleInvalidations = [];
      for (const type of [
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
        document.addEventListener(
          type,
          (event) => {
            window.__idleInvalidations.push({
              at: performance.now(),
              type,
              property: event.propertyName,
              target: event.target.tagName,
              id: event.target.id,
              className: event.target.getAttribute?.("class"),
              pseudo: event.pseudoElement,
            });
          },
          { capture: true, passive: true },
        );
      }
      new MutationObserver((records) => {
        window.__idleInvalidations.push(
          ...records.map((record) => ({
            at: performance.now(),
            type: record.type,
            attribute: record.attributeName,
            target: record.target.nodeName,
            id: record.target.id,
            className:
              record.target instanceof Element
                ? record.target.getAttribute("class")
                : undefined,
          })),
        );
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    });
    const baseline = await measure(page, client, "baseline", () => wait(5000));
    const invalidations = await page.evaluate(() => window.__idleInvalidations);
    const result = {
      ...report,
      browser: context.browser().version(),
      mode,
      site: target.name,
      url: target.url,
      baseline,
      invalidations,
    };
    if (mode === "on") {
      // 診断専用。イベントの伝播を止めるため、通常のサイト動作の性能値には使わない。
      await page.evaluate(() => {
        window.__blockedTransitions = 0;
        window.addEventListener(
          "transitionend",
          (event) => {
            window.__blockedTransitions++;
            event.stopImmediatePropagation();
          },
          { capture: true },
        );
      });
      await wait(1000);
      await page.evaluate(() => {
        window.__blockedTransitions = 0;
        window.__idleInvalidations = [];
      });
      result.withTransitionEndBlocked = await measure(
        page,
        client,
        "transitionend-blocked",
        () => wait(4000),
      );
      result.blockedTransitions = await page.evaluate(
        () => window.__blockedTransitions,
      );
      result.remainingInvalidations = await page.evaluate(
        () => window.__idleInvalidations,
      );
    }
    await writeFile(
      resolve(output, `${target.name}-${mode}-feedback.json`),
      JSON.stringify(result, null, 2) + "\n",
    );
    const counts = {};
    for (const entry of invalidations)
      counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    console.log(
      JSON.stringify({
        mode,
        site: target.name,
        elapsed: baseline.elapsedMs,
        renders: baseline.render.count,
        task: baseline.mainThreadMs,
        counts,
        gated: result.withTransitionEndBlocked,
      }),
    );
  } finally {
    await context.close();
  }
}
const publicTargets = [
  { name: "wikipedia", url: "https://en.wikipedia.org/wiki/Color" },
  {
    name: "sheets",
    url: "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
  },
];

try {
  if (diagnose) {
    for (const target of publicTargets)
      for (const mode of ["on", "off"]) await diagnoseIdle(mode, target);
  } else if (live) {
    for (const target of publicTargets)
      for (const mode of ["off", "on", "off"]) await liveTrial(mode, target);
  } else {
    const orders = quick
      ? [["off", "on"]]
      : [
          ["off", "on", "absent"],
          ["on", "absent", "off"],
          ["absent", "off", "on"],
        ];
    for (const cards of quick || largeOnly ? [600] : [100, 600])
      for (const [round, modes] of orders.entries())
        for (const mode of modes) await localTrial(mode, cards, round);
  }
} finally {
  await new Promise((done) => server.close(done));
}
