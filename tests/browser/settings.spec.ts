import {
  test,
  expect,
  expectReadableDark,
  openPopup,
  setGlobalEnabled,
} from "./fixtures";

test("除外設定を保存・再表示でき、不正な入力は保存済みの設定を破壊しない", async ({
  page,
  extensionContext,
  extensionId,
}) => {
  const options = await extensionContext.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const input = options.getByLabel("除外するドメイン");
  await input.fill("EXAMPLE.TEST.\nexample.test");
  await options.getByRole("button", { name: "設定を保存" }).click();
  await expect(options.getByRole("status")).toContainText("設定を保存しました");
  await options.reload();
  await expect(input).toHaveValue("example.test");
  await input.fill("https://example.test/path");
  await options.getByRole("button", { name: "設定を保存" }).click();
  await expect(options.getByRole("alert")).toContainText("ドメインだけを入力");
  await options.reload();
  await expect(input).toHaveValue("example.test");

  await page.route("https://**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !["example.test", "sub.example.test", "notexample.test"].includes(
        url.hostname,
      )
    ) {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><body style="background:white;color:black">Domain test<iframe srcdoc="<body style=\'background:white;color:black\'>srcdoc</body>"></iframe></body>',
    });
  });
  for (const host of ["example.test", "sub.example.test"]) {
    await page.goto(`https://${host}/any/path`);
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expect(page.locator("body")).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(page.frameLocator("iframe").locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
  }
  await page.goto("https://notexample.test/");
  await expectReadableDark(page.locator("body"));
  await input.fill("");
  await options.getByRole("button", { name: "設定を保存" }).click();
  await expect(options.getByRole("status")).toContainText("設定を保存しました");
  await page.goto("https://sub.example.test/");
  await expectReadableDark(page.locator("body"));
});

test("現在のドメインをポップアップで除外し、設定画面で解除できる", async ({
  page,
  extensionContext,
  extensionId,
}) => {
  await page.goto("http://127.0.0.1:4173/");
  await expectReadableDark(page.locator("body"));
  const popup = await openPopup(extensionContext, extensionId, page);
  await expect(popup.locator("#current-domain")).toHaveText("127.0.0.1");
  await popup
    .getByRole("button", { name: "このドメイン配下で無効にする" })
    .click();
  await expect(popup.getByRole("status")).toContainText("除外を保存しました");
  await expect(
    popup.getByRole("button", { name: "除外済み", exact: true }),
  ).toBeDisabled();
  const opened = extensionContext.waitForEvent("page");
  await popup.getByRole("button", { name: "除外ドメインの設定を開く" }).click();
  const options = await opened;
  await expect(options.getByLabel("除外するドメイン")).toHaveValue("127.0.0.1");
  await page.reload();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await options.screenshot({ path: "test-results/options-domains.png" });
  await options.getByLabel("除外するドメイン").fill("");
  await options.getByRole("button", { name: "設定を保存" }).click();
  await expect(options.getByRole("status")).toContainText("設定を保存しました");
  await page.reload();
  await expectReadableDark(page.locator("body"));
});

test("除外設定の保存や解除で、全体の OFF を勝手に ON にしない", async ({
  page,
  extensionContext,
  extensionId,
}) => {
  await page.goto("http://127.0.0.1:4173/");
  await expectReadableDark(page.locator("body"));
  await setGlobalEnabled(extensionContext, extensionId, page, false);
  const options = await extensionContext.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  for (const domains of ["127.0.0.1", ""]) {
    await options.getByLabel("除外するドメイン").fill(domains);
    await options.getByRole("button", { name: "設定を保存" }).click();
    await expect(options.getByRole("status")).toContainText(
      "設定を保存しました",
    );
    await page.reload();
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
  }
  const popup = await openPopup(extensionContext, extensionId, page);
  await expect(popup.getByRole("switch")).not.toBeChecked();
});
