import { expect, test, type Page } from '@playwright/test'

const runId = Date.now().toString(36)
const adminName = `vue3admin-${runId}`
const userName = `vue3user-${runId}`
const learnerName = `vue3learner-${runId}`
const rootPassword = process.env.VUE3_ACCEPTANCE_ROOT_PASSWORD || 'Vue3Root!2026'
const adminPassword = 'Vue3Admin!2026'
const userPassword = 'Vue3User!2026'
const learnerPassword = 'Vue3Learner!2026'

async function login(page: Page, username: string, password: string, admin = false) {
  await page.goto(admin ? '/admin/login' : '/login')
  await page.getByLabel('用户名或邮箱').fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: admin ? '登录' : '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login$/)
}

async function logout(page: Page) {
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
}

async function createUser(page: Page, username: string, password: string, preset: 'standard' | 'learner') {
  await page.getByRole('button', { name: '添加用户', exact: true }).click()
  await page.getByPlaceholder('用户名', { exact: true }).fill(username)
  await page.getByPlaceholder('密码（至少 8 位）', { exact: true }).fill(password)
  await page.getByRole('radio', { name: preset === 'learner' ? /学习者/ : /标准/ }).check()
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '创建成功' })).toBeVisible()
  await expect(page.locator('main').getByText(username, { exact: true })).toBeVisible()
}

test('PostgreSQL super-admin, admin, user and learner role flows', async ({ page }) => {
  await login(page, 'vue3root', rootPassword, true)
  await expect(page).toHaveURL(/\/admin\/users$/)
  await page.goto('/admin/accounts')
  await page.getByPlaceholder('用户名', { exact: true }).fill(adminName)
  await page.getByPlaceholder('密码（至少 8 位）', { exact: true }).fill(adminPassword)
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.locator('main').getByText(adminName, { exact: true })).toBeVisible()
  await logout(page)

  await login(page, adminName, adminPassword, true)
  await expect(page).toHaveURL(/\/admin\/users$/)
  await page.goto('/admin/accounts')
  await expect(page).toHaveURL(/\/admin\/users$/)
  await createUser(page, userName, userPassword, 'standard')
  await createUser(page, learnerName, learnerPassword, 'learner')
  await logout(page)

  await login(page, userName, userPassword)
  await expect(page).toHaveURL(/\/chat$/)
  await page.goto('/settings/llm')
  await expect(page.getByLabel('Profile ID', { exact: true })).toBeVisible()
  const realModel = process.env.VUE3_ACCEPTANCE_REAL_LLM === '1'
  await page.locator('.model-add-button').click()
  await page.getByLabel('Profile ID', { exact: true }).fill('personal-llm')
  await page.getByLabel('Profile 显示名称', { exact: true }).fill('My personal model')
  await page.getByLabel('Profile 提供方', { exact: true }).fill('openai')
  await page.getByLabel('Profile Base URL', { exact: true }).fill(realModel ? process.env.VUE3_ACCEPTANCE_MODEL_BASE_URL! : 'http://127.0.0.1:9/v1')
  await page.getByLabel('Profile API Key', { exact: true }).fill(realModel ? process.env.VUE3_ACCEPTANCE_MODEL_API_KEY! : 'test-only')
  await page.getByLabel('首个模型 ID', { exact: true }).fill(realModel ? process.env.VUE3_ACCEPTANCE_MODEL_NAME! : 'test-model')
  await page.getByRole('button', { name: '添加 Profile', exact: true }).click()
  await page.getByRole('button', { name: '应用更改', exact: true }).click()
  await expect(page.getByText('模型配置已应用')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'My personal model' })).toBeVisible()
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/chat$/)
  await page.goto('/co-writer')
  await page.getByRole('button', { name: '新建页面', exact: true }).first().click()
  await expect(page).toHaveURL(/\/co-writer\/[^/]+$/)
  await page.getByLabel('页面标题').fill('PostgreSQL note')
  await page.locator('.rich-note-content p').first().selectText()
  await page.keyboard.type('Persisted rich text')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('页面标题')).toHaveValue('PostgreSQL note')
  await expect(page.locator('.rich-note-content')).toContainText('Persisted rich text')
  await page.getByLabel('上传笔记附件').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
  await expect(page.locator('.learning-special-block img')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '导出 Word' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('PostgreSQL note.docx')
  if (process.env.VUE3_ACCEPTANCE_REAL_LLM === '1') {
    test.setTimeout(120_000)
    await page.goto('/chat')
    await page.getByPlaceholder('今天我能帮您什么？').fill('Reply with exactly VUE3_OK and nothing else.')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.locator('.message.assistant').last()).toContainText('VUE3_OK', { timeout: 90_000 })
    await expect(page).toHaveURL(/\/chat\/[^/]+$/)
    await page.reload()
    await expect(page.locator('.message.assistant').last()).toContainText('VUE3_OK', { timeout: 15_000 })
  }
  await logout(page)

  await login(page, learnerName, learnerPassword)
  await page.goto('/settings/learner-profile')
  await page.getByLabel('年龄', { exact: true }).fill('12')
  await page.getByLabel('年级', { exact: true }).fill('6')
  await page.getByRole('button', { name: '保存档案' }).click()
  await expect(page.getByText('学习者档案已保存')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('年龄', { exact: true })).toHaveValue('12')
  await expect(page.getByLabel('年级', { exact: true })).toHaveValue('6')
})
