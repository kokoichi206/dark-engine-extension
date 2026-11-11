import {
  test,
  expect,
  expectReadableDark,
  readPaintedColors,
} from "./fixtures";

test("配色の適用で操作完了を誤発火させず、サイト本来のトランジションは完了する", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/transitions.html");
  for (const id of ["#light-root", "#shadow-root"])
    await expectReadableDark(page.locator(id).locator("#feedback"));
  // 初回変換と CSSOM の初回検出の後も、操作なしで完了通知が出ないことを確認する。
  await page.waitForTimeout(2200);
  for (const id of ["#light-root", "#shadow-root"]) {
    const root = page.locator(id);
    await expect(root.locator("#completion")).toHaveText("操作待ち");
    await root.getByRole("button", { name: "透明度を変える" }).click();
    await expect(root.locator("#feedback")).toHaveCSS("opacity", "0.5");
    await expect(root.locator("#completion")).toHaveText("操作完了");
    await root.getByRole("button", { name: "元の文字色を変える" }).click();
    await expect(root.locator("#unrelated-update")).toHaveText("1");
    await expect(root.locator("#protected-completion")).toHaveText("操作完了");
    await expect(root.locator("#protected")).toHaveCSS(
      "color",
      "rgb(255, 204, 68)",
    );
  }
});

test("同色の面の片方だけ変更しても、隣の面と疑似要素の配色を変えない", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/transitions.html");
  for (const id of ["#light-root", "#shadow-root"]) {
    const root = page.locator(id);
    const first = root.locator("#first");
    const second = root.locator("#second");
    const third = root.locator("#third");
    for (const surface of [first, second, third]) {
      await expectReadableDark(surface);
      await expectReadableDark(surface, "::before");
    }
    const original = await readPaintedColors(first);
    const secondBefore = await readPaintedColors(second, "::before");
    expect((await readPaintedColors(first, "::before")).background).not.toEqual(
      secondBefore.background,
    );
    expect(await readPaintedColors(third)).toEqual(original);
    await root.getByRole("button", { name: "先頭の配色を変える" }).click();
    await expect
      .poll(async () => (await readPaintedColors(first)).background)
      .not.toEqual(original.background);
    await expectReadableDark(first);
    expect(await readPaintedColors(second)).toEqual(original);
    expect(await readPaintedColors(third)).toEqual(original);
    expect(await readPaintedColors(second, "::before")).toEqual(secondBefore);
    await root.getByRole("button", { name: "先頭の配色を変える" }).click();
    await expect
      .poll(async () => await readPaintedColors(first))
      .toEqual(original);
  }
});

test("色の遷移を中断した後も、追加された面を暗くして読める状態へ戻す", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4173/transitions.html");
  for (const id of ["#light-root", "#shadow-root"]) {
    const root = page.locator(id);
    await expectReadableDark(root.locator("#feedback"));
    await root
      .getByRole("button", { name: "色の遷移を中断して面を追加" })
      .click();
    await expectReadableDark(root.locator("#after-cancel"));
  }
});
