import { expect, test, type Page } from '@playwright/test';

// Drive the real Dock entry's existing open handler in Vite dev mode. No production test hooks
// or Tauri globals are added; all typing, selection, and checkbox clicks use the real browser.
async function openDock(page: Page) {
  await page.goto('/#/dock-panel');
  await page.locator('.dock-panel-window').waitFor({ state: 'attached' });
  await page.evaluate(async () => {
    const instance = (document.querySelector('.dock-panel-window') as any).__vueParentComponent;
    await instance.setupState.handleOpen({ isNew: true, anchorSide: 'right' });
  });
}
async function source(page: Page) {
  return page.locator('.cm-editor').evaluate(async element => {
    const modulePath = '/node_modules/.vite/deps/@codemirror_view.js';
    const { EditorView } = await import(/* @vite-ignore */ modulePath);
    const view = EditorView.findFromDOM(element);
    return { text: view.state.doc.toString(), head: view.state.selection.main.head, lines: view.state.doc.lines };
  });
}
async function bodyFocus(page: Page) {
  await page.locator('.editor-title').focus();
  await page.keyboard.press('Enter');
}

for (const entry of ['library', 'dock'] as const) test.describe(`${entry} actual editor`, () => {
  test.beforeEach(async ({ page }) => {
    if (entry === 'dock') await openDock(page);
    else { await page.goto('/'); await page.getByRole('button', { name: '新建便签', exact: true }).click(); }
    await expect(page.locator('.cm-editor')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
  });
  test.afterEach(async ({ page }) => {
    expect(await page.pageErrors()).toEqual([]);
  });

  test('placeholder disappears immediately and repeated Enter never moves input backwards', async ({ page }) => {
    await expect(page.locator('.cm-placeholder')).toBeVisible();
    await bodyFocus(page);
    await page.keyboard.type('a');
    await expect(page.locator('.cm-placeholder')).toHaveCount(0);
    await page.keyboard.press('Enter'); await page.keyboard.type('b');
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.insertText('中文');
    expect(await source(page)).toEqual({ text: 'a\nb\n\n中文', head: 7, lines: 4 });
    await page.waitForTimeout(1100); // Exercise a parent re-render after debounced save.
    await page.keyboard.press('Enter'); await page.keyboard.type('c');
    expect((await source(page)).text).toBe('a\nb\n\n中文\nc');
    await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
    await expect(page.locator('.cm-placeholder')).toBeVisible();
    await page.keyboard.press('Enter'); await page.keyboard.type('z');
    expect((await source(page)).text).toBe('\nz');
  });

  test('empty task caret is physically to the right of its checkbox', async ({ page }, testInfo) => {
    await page.getByTitle('插入任务', { exact: true }).click();
    await expect(page.locator('.cm-placeholder')).toHaveCount(0);
    expect((await source(page)).head).toBe(2);
    const box = await page.locator('.editor-task-box').boundingBox();
    await expect.poll(async () => {
      const cursor = await page.locator('.cm-cursor').first().boundingBox();
      return (cursor?.x ?? -1) - (box!.x + box!.width);
    }).toBeGreaterThanOrEqual(5);
    await page.screenshot({ path: testInfo.outputPath('empty-task-caret.png'), caret: 'initial' });
    await page.keyboard.insertText('任务一'); await page.keyboard.press('Enter');
    await page.keyboard.insertText('任务二');
    expect((await source(page)).text).toBe('☐ 任务一\n☐ 任务二');
    await page.locator('.editor-task-box').first().click();
    await page.keyboard.type('!');
    expect((await source(page)).text).toBe('☑ 任务一!\n☐ 任务二');
    const selectionInButton = await page.evaluate(() => document.querySelector('.editor-task-box')!.contains(getSelection()?.anchorNode ?? null));
    expect(selectionInButton).toBe(false);
  });

  test('task keyboard activation, blank-task exit, undo and redo stay coherent', async ({ page }) => {
    await page.getByTitle('插入任务', { exact: true }).click();
    await page.locator('.editor-task-box').focus(); await page.keyboard.press('Space');
    expect((await source(page)).text).toBe('☑ ');
    await page.keyboard.type('done'); await page.keyboard.press('Enter');
    expect((await source(page)).text).toBe('☑ done\n☐ ');
    await page.keyboard.press('Enter'); expect((await source(page)).text).toBe('☑ done\n');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y'); expect((await source(page)).text).toBe('☑ done\n');
  });

  test('real selection replacement, multiline paste, and Markdown formatting preserve text', async ({ page }) => {
    await bodyFocus(page); await page.keyboard.type('abcd');
    await page.keyboard.press('Enter'); await page.keyboard.type('efgh');
    await page.keyboard.press('Control+a');
    await page.locator('.cm-content').evaluate(element => {
      const data = new DataTransfer(); data.setData('text/plain', 'one\r\ntwo');
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    expect((await source(page)).text).toBe('one\ntwo');
    await page.keyboard.press('Control+a');
    await page.getByTitle('粗体（在星号中输入）', { exact: true }).click();
    expect((await source(page)).text).toBe('**one\ntwo**');
    await page.keyboard.press('Enter'); expect((await source(page)).text).toBe('**\n**');
  });

  test('Chromium IME composition removes placeholder and does not manufacture a newline', async ({ page, context }) => {
    await bodyFocus(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
    await expect(page.locator('.cm-placeholder')).toHaveCount(0);
    await cdp.send('Input.insertText', { text: '中文' });
    await page.waitForTimeout(100);
    expect((await source(page)).text).toBe('中文');
    await page.keyboard.press('Enter'); await page.keyboard.insertText('下一行');
    expect((await source(page)).text).toBe('中文\n下一行');
  });

  test('arrow keys skip task markers and Backspace removes only the task prefix', async ({ page }) => {
    await page.getByTitle('插入任务', { exact: true }).click();
    await page.keyboard.press('ArrowLeft'); expect((await source(page)).head).toBe(0);
    await page.keyboard.press('ArrowRight'); expect((await source(page)).head).toBe(2);
    await page.keyboard.type('text'); await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    expect((await source(page)).head).toBe(2);
    await page.keyboard.press('Backspace'); expect((await source(page)).text).toBe('text');
  });

  test('code fences preserve literal task syntax instead of inserting checkboxes', async ({ page }) => {
    await bodyFocus(page); await page.keyboard.insertText('```text\n☐ literal\n- [ ] literal\n```');
    await expect(page.locator('.editor-task-box')).toHaveCount(0);
  });

  test('long notes scroll only the editor and keep the current caret visible', async ({ page }) => {
    await bodyFocus(page);
    await page.keyboard.insertText(Array.from({ length: 45 }, (_, i) => `第${i + 1}行 这是用于检查滚动的内容`).join('\n'));
    await page.keyboard.press('Enter'); await page.keyboard.type('last');
    await expect.poll(() => page.locator('.cm-scroller').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const scroller = await page.locator('.cm-scroller').boundingBox();
    const cursor = await page.locator('.cm-cursor').first().boundingBox();
    expect(cursor!.y).toBeGreaterThanOrEqual(scroller!.y);
    expect(cursor!.y + cursor!.height).toBeLessThanOrEqual(scroller!.y + scroller!.height + 1);
    expect(await page.locator('.cm-scroller').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});

test('Dock save-preview-edit and new-note sessions do not retain stale placeholders or history', async ({ page }) => {
  await openDock(page); await bodyFocus(page); await page.keyboard.insertText('\n保留空行\n\n');
  await page.evaluate(async () => {
    const state = (document.querySelector('.dock-panel-window') as any).__vueParentComponent.setupState;
    await state.finishEditing();
  });
  await page.getByRole('button', { name: '编辑便签', exact: true }).click();
  expect((await source(page)).text).toBe('\n保留空行\n\n');
  await page.evaluate(async () => {
    await (document.querySelector('.dock-panel-window') as any).__vueParentComponent.setupState.handleOpen({ isNew: true, anchorSide: 'right' });
  });
  await expect(page.locator('.cm-placeholder')).toBeVisible();
  await bodyFocus(page); await page.keyboard.press('Control+z');
  expect((await source(page)).text).toBe('');
});
