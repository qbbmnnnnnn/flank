import { test, expect } from '@playwright/test';

for (const size of [{ width: 720, height: 700 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }]) {
  test(`Dock normal-motion geometry at ${size.width}x${size.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1.25, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:1420/#/dock-panel');
    await page.locator('.dock-panel-window').waitFor({ state: 'attached' });
    await page.evaluate(async () => {
      await (document.querySelector('.dock-panel-window') as any).__vueParentComponent.setupState.handleOpen({ isNew: true, anchorSide: 'right' });
    });
    await page.waitForTimeout(1100); // Existing Dock entrance, including the final measurement refresh.
    await page.locator('.editor-title').focus(); await page.keyboard.press('Enter');
    const placeholder = await page.locator('.cm-placeholder').boundingBox();
    await expect.poll(async () => Math.abs((await page.locator('.cm-cursor').first().boundingBox())!.x - placeholder!.x)).toBeLessThan(2);
    await page.keyboard.insertText('第一行'); await page.keyboard.press('Enter');
    await page.getByTitle('插入任务', { exact: true }).click();
    const checkbox = await page.locator('.editor-task-box').boundingBox();
    await expect.poll(async () => (await page.locator('.cm-cursor').first().boundingBox())!.x - checkbox!.x - checkbox!.width).toBeGreaterThan(5);
    await page.keyboard.insertText('待办内容'); await page.keyboard.press('Enter'); await page.keyboard.insertText('继续输入');
    await expect(page.locator('.cm-placeholder')).toHaveCount(0);
    expect(await page.locator('.cm-scroller').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.pageErrors()).toEqual([]);
    await page.locator('.note-panel').screenshot({ path: testInfo.outputPath('dock-editor.png'), caret: 'initial' });
    await context.close();
  });
}
