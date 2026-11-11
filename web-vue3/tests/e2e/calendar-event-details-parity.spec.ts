import { expect, test } from '@playwright/test'

const event = {
  id: 'e1', event_id: 'e1', occurrence: '2026-11-10', recurring: true,
  calendar_id: 'c1', title: 'Study vectors', notes: 'Review the diagram',
  location: 'Library', all_day: true, start: '2026-11-10', end: '2026-11-10',
  rrule: 'FREQ=WEEKLY', color: '#123456', reminders: [10, 60], task_id: 't1', source: 'dito',
}

async function mockCalendar(page: import('@playwright/test').Page) {
  let deleted = false
  await page.route('**/api/auth/status*', route => route.fulfill({ json: { enabled: false, authenticated: false, is_admin: false } }))
  await page.route('**/api/calendar/calendars?*', route => route.fulfill({ json: { calendars: [{ id: 'c1', name: 'Main calendar', color: '#123456', visible: true, is_default: true }] } }))
  await page.route('**/api/calendar/events?*', route => route.fulfill({ json: { occurrences: deleted ? [] : [event] } }))
  await page.route('**/api/calendar/layers?*', route => route.fulfill({ json: { reviews: [], automations: [], footprints: [] } }))
  await page.route('**/api/task-board?*', route => route.fulfill({ json: { cards: [{ id: 't1', title: 'Read chapter', status: 'todo', due_date: '2026-11-10', archived: false }] } }))
  await page.route('**/api/calendar/stream*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }))
  await page.route('**/api/calendar/events/e1?*', route => {
    if (route.request().method() === 'DELETE') {
      deleted = true
      return route.fulfill({ json: { undo_token: 'undo-1' } })
    }
    return route.fulfill({ json: {} })
  })
}

test('calendar event opens legacy details, duplicate, edit and scoped delete', async ({ page }) => {
  await mockCalendar(page)
  await page.goto('/calendar')
  const chip = page.locator('.calendar-cell').filter({ hasText: 'Study vectors' }).locator('.calendar-event-chip').first()
  await chip.click()

  const detail = page.getByRole('dialog', { name: '日程详情' })
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('Study vectors')
  await expect(detail).toContainText('每周重复')
  await expect(detail).toContainText('Library')
  await expect(detail).toContainText('Review the diagram')
  await expect(detail).toContainText('Main calendar')
  await expect(detail).toContainText('由 Dito 安排')
  await expect(detail.getByRole('button', { name: '编辑日程' })).toBeVisible()
  await expect(detail.getByRole('button', { name: '复制', exact: true })).toBeVisible()
  await expect(detail.getByRole('button', { name: '删除日程' })).toBeVisible()

  await detail.getByRole('button', { name: '复制', exact: true }).click()
  await expect(page.locator('.calendar-editor')).toContainText('新建日程')
  await expect(page.locator('.calendar-title-input')).toHaveValue('Study vectors')
  await expect(page.getByLabel('重复', { exact: true })).toHaveValue('')
  await page.locator('.calendar-editor').getByRole('button', { name: '关闭' }).click()

  await chip.click()
  await page.getByRole('dialog', { name: '日程详情' }).getByRole('button', { name: '编辑日程' }).click()
  await expect(page.locator('.calendar-editor')).toContainText('编辑日程')
  await expect(page.locator('.calendar-title-input')).toHaveValue('Study vectors')
  await page.locator('.calendar-editor').getByRole('button', { name: '关闭' }).click()

  await chip.click()
  await page.getByRole('dialog', { name: '日程详情' }).getByRole('button', { name: '删除日程' }).click()
  const confirmation = page.getByRole('dialog', { name: '删除日程' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByLabel('操作范围')).toHaveValue('this')
  await confirmation.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.locator('.notice')).toContainText('日程已删除')
  await expect(page.getByRole('dialog', { name: '删除日程' })).toHaveCount(0)
})

test('calendar event details stay inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockCalendar(page)
  await page.goto('/calendar')
  await page.locator('.calendar-cell').filter({ hasText: 'Study vectors' }).locator('.calendar-event-chip').first().click()
  const dialog = page.getByRole('dialog', { name: '日程详情' })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('month blank cells create all-day events and keyboard shortcuts switch views', async ({ page }) => {
  await mockCalendar(page)
  await page.goto('/calendar')
  await page.locator('[data-day="2026-11-11"]').click({ position: { x: 30, y: 58 } })
  await expect(page.locator('.calendar-editor')).toContainText('新建日程')
  await expect(page.getByLabel('全天', { exact: true })).toBeChecked()
  await expect(page.getByLabel('开始', { exact: true })).toHaveValue('2026-11-11')
  await expect(page.getByLabel('结束', { exact: true })).toHaveValue('2026-11-12')
  await page.locator('.calendar-editor').getByRole('button', { name: '关闭' }).click()

  await page.locator('[data-day="2026-11-11"] .calendar-cell-date').click()
  await expect(page.getByRole('tab', { name: '日', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('m')
  await expect(page.getByRole('tab', { name: '月', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox')).toBeFocused()
  await page.keyboard.press('Escape')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('c')
  await expect(page.locator('.calendar-editor')).toContainText('新建日程')
})
