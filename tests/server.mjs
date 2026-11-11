import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/image.svg")) {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#ff9900"/></svg>',
    );
    return;
  }
  if (req.url === "/strict.html") {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; script-src 'none';",
    });
    res.end(
      '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><link rel="stylesheet" href="/strict.css"><title>CSP 検証</title></head><body><h1>CSP が厳しいページ</h1><p>通常の CSS と新しい色指定を変換します。</p><div class="modern">OKLCH の面</div></body></html>',
    );
    return;
  }
  if (req.url === "/strict.css") {
    res.writeHead(200, { "Content-Type": "text/css" });
    res.end(
      "body { background: white; color: black; } .modern { background: oklch(95% .035 250); color: color(display-p3 .1 .1 .1); }",
    );
    return;
  }
  if (req.url === "/cross-origin.css") {
    res.writeHead(200, { "Content-Type": "text/css" });
    res.end(
      ".cross-origin {background: rgb(250, 250, 250); color: rgb(20, 20, 20);}",
    );
    return;
  }
  if (req.url === "/frame.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      '<!doctype html><body style="background:white;color:black">別フレームの背景と文字</body>',
    );
    return;
  }
  if (req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  const file = ["/fixture.js", "/transitions.html", "/transitions.js"].includes(
    req.url,
  )
    ? req.url.slice(1)
    : "page.html";
  const body = await readFile(new URL(`./fixtures/${file}`, import.meta.url));
  res.writeHead(200, {
    "Content-Type": file.endsWith(".js") ? "text/javascript" : "text/html",
    "Content-Security-Policy":
      "script-src 'self'; style-src 'self' 'unsafe-inline' http://127.0.0.1:4174; img-src data:;",
  });
  res.end(body);
});
server.listen(4173, "127.0.0.1");
const cssServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/css" });
  res.end(
    ".cross-origin {background: rgb(250, 250, 250); color: rgb(20, 20, 20);}",
  );
});
cssServer.listen(4174, "127.0.0.1");
