import { expect, test } from '@playwright/test';

test('card preview preserves body order and clips before the timestamp', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建便签', exact: true }).click();
  await page.locator('.editor-title').fill('预览顺序测试');
  await page.locator('.editor-title').press('Enter');
  await page.keyboard.insertText([
    '☐ 图片之前',
    '![示例图片](https://example.com/noty-preview.png)',
    '☐ 图片之后',
    ...Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 条过长内容`),
  ].join('\n'));
  await page.locator('.note-detail-dismiss').click({ position: { x: 8, y: 8 } });

  const card = page.locator('.note-card').filter({ hasText: '预览顺序测试' });
  await expect(card).toBeVisible();
  const segments = card.locator('.card-body > *');
  await expect(segments).toHaveCount(3);
  await expect(segments.nth(0)).toHaveClass(/card-preview/);
  await expect(segments.nth(0)).toContainText('图片之前');
  await expect(segments.nth(1)).toHaveClass(/card-image/);
  await expect(segments.nth(2)).toHaveClass(/card-preview/);
  await expect(segments.nth(2)).toContainText('图片之后');

  const layout = await card.evaluate(element => {
    const body = element.querySelector<HTMLElement>('.card-body')!;
    const time = element.querySelector<HTMLElement>('.card-time')!;
    const bodyRect = body.getBoundingClientRect();
    const timeRect = time.getBoundingClientRect();
    return {
      overflow: getComputedStyle(body).overflow,
      isTruncated: body.scrollHeight > body.clientHeight,
      contentEndsBeforeTime: bodyRect.bottom <= timeRect.top,
    };
  });
  expect(layout).toEqual({ overflow: 'hidden', isTruncated: true, contentEndsBeforeTime: true });
});
