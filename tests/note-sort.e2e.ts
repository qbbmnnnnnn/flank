import { expect, test, type Locator, type Page } from '@playwright/test';

async function longPressDrag(page: Page, source: Locator, target: Locator, x?: number) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('sortable note is not visible');
  await page.mouse.move(x ?? from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(280);
  await page.mouse.move(x ?? to.x + to.width / 2, to.y + to.height - 8, { steps: 12 });
  await page.mouse.up({ button: 'left' });
}

test('all notes preserve clicks and reorder after a primary-button hold', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: '列表视图' }).click();
  const cards = page.locator('.recent-grid .note-card');
  await expect(cards).toHaveCount(6);

  await cards.nth(0).click();
  await expect(cards.nth(0)).toHaveClass(/selected/);
  const firstId = await cards.nth(0).getAttribute('data-note-id');
  const secondId = await cards.nth(1).getAttribute('data-note-id');
  const thirdId = await cards.nth(2).getAttribute('data-note-id');

  await longPressDrag(page, cards.nth(0), cards.nth(2));
  await expect(cards.nth(0)).toHaveAttribute('data-note-id', secondId!);
  await expect(cards.nth(1)).toHaveAttribute('data-note-id', thirdId!);
  await expect(cards.nth(2)).toHaveAttribute('data-note-id', firstId!);
  await expect(page.locator('.note-detail')).toHaveCount(0);
});

test('Dock notes reorder vertically after a primary-button hold', async ({ page }) => {
  await page.goto('/#/dock');
  const tabs = page.locator('.note-list .note-tab:not(.guide)');
  await expect(tabs).toHaveCount(3);
  const firstId = await tabs.nth(0).getAttribute('data-id');
  const secondId = await tabs.nth(1).getAttribute('data-id');
  const thirdId = await tabs.nth(2).getAttribute('data-id');
  const first = await tabs.nth(0).boundingBox();
  if (!first) throw new Error('Dock note is not visible');

  await longPressDrag(page, tabs.nth(0), tabs.nth(2), Math.min(page.viewportSize()!.width - 8, first.x + first.width - 8));
  await expect(tabs.nth(0)).toHaveAttribute('data-id', secondId!);
  await expect(tabs.nth(1)).toHaveAttribute('data-id', thirdId!);
  await expect(tabs.nth(2)).toHaveAttribute('data-id', firstId!);
});
