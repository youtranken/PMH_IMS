import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  SECOND_BROWSER,
  catalogItem,
  firstLogin,
  resetDiagrams,
  resetUsers,
  stepUpViaApi,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/*
 * Soát UX đợt 2 — Sơ đồ mạng (Q-23): những đường người dùng THẤY trên giao diện.
 * Luật server đã có bài DB thật (`api/test/diagrams.spec.ts`, `diagram-review.spec.ts`); ở đây đi
 * đúng đường bấm: bản vẽ con lấy Site của bản cha (D-03), Thành viên không gửi duyệt hộ (D-04),
 * người duyệt thấy bản vẽ chờ duyệt (D-07), Ctrl+K tìm được bản vẽ (D-08).
 */

test.beforeEach(() => {
  resetUsers();
  resetDiagrams();
});

const XML =
  '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="s1" value="Phòng E2E" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="40" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram></mxfile>';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="80px"><g data-cell-id="s1"><rect x="10" y="10" width="120" height="40"/></g></svg>';

async function createDiagram(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** `label` khác nhau = nét vẽ khác nhau: lưu y nguyên bản mới nhất không tạo phiên bản (Q-23). */
async function save(page: Page, id: string, label = 'Phòng E2E'): Promise<{ id: string; seq: number }> {
  const res = await page.request.post(`/api/v1/diagrams/${id}/versions`, {
    headers: await writeHeaders(page),
    data: { xml: XML.replace('Phòng E2E', label), svg: SVG, basedOnVersionId: null },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; seq: number };
}

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Bản vẽ đang chọn' });
}

test.describe('Sơ đồ mạng — soát UX đợt 2', () => {
  test('D-03: bản vẽ con điền sẵn Site của bản cha; ô Tủ chỉ hiện khi cấp là tủ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const siteCode = `E2E-UX2-${stamp}`;
    const siteId = await catalogItem(page, 'site', { code: siteCode, name: `Site E2E UX2 ${stamp}` });
    const name = `E2E Cha UX2 ${stamp}`;
    const id = await createDiagram(page, { name, nodeType: 'site', siteId });

    await page.goto(`/diagrams?node=${id}`);
    await panel(page).getByRole('button', { name: `Thao tác với ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Thêm bản vẽ con' }).click();
    const dialog = page.getByRole('dialog', { name: `Thêm bản vẽ con vào "${name}"` });
    await expect(dialog.getByRole('button', { name: 'Site' })).toContainText(siteCode);
    await expect(dialog.getByRole('button', { name: 'Loại bản vẽ' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Tủ/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Loại bản vẽ' }).click();
    await page.getByRole('option', { name: 'Tủ mạng' }).click();
    await expect(dialog.getByRole('button', { name: /^Tủ/ })).toBeVisible();
    await expect(dialog.getByText(/Gắn tủ để dựng mặt tủ từ kho/)).toBeVisible();
    await expect(dialog.getByText(/Chỉ để phân loại trên cây — cây do "bản vẽ con" quyết định/)).toBeVisible();
    // Đường hỏng của "Dựng từ kho" (Q-23): chưa chọn tủ thì tắt, nói rõ vì sao.
    await expect(dialog.getByRole('radio', { name: 'Dựng từ kho' })).toBeDisabled();
    await expect(dialog.getByText('Chọn tủ trước.')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Trang trắng' })).toBeChecked();

    // Server chặn gắn tủ cho cấp khác — kể cả gọi thẳng API.
    const cabinetId = await catalogItem(page, 'cabinet', { siteId, code: `E2E-UX2-TU${stamp}` });
    const bad = await page.request.post('/api/v1/diagrams', {
      headers: await writeHeaders(page),
      data: { name: `E2E Gốc gắn tủ ${stamp}`, nodeType: 'company', siteId, cabinetId },
      failOnStatusCode: false,
    });
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'DIAGRAM_CABINET_NEEDS_CABINET_LEVEL' });
  });

  test('D-04 + D-07: Thành viên không gửi duyệt nháp người khác; gửi nháp của mình thì Admin/SA thấy trên menu và màn Duyệt', async ({ browser, page }) => {
    const saSecret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const name = `E2E Duyệt UX2 ${stamp}`;
    const id = await createDiagram(page, { name, nodeType: 'floor' });
    await stepUpViaApi(page, saSecret, 'diagram');
    await save(page, id);

    const member = await (await browser.newContext(SECOND_BROWSER)).newPage();
    const memberSecret = await firstLogin(member, E2E_MEMBER);
    await member.goto(`/diagrams?node=${id}`);
    await expect(panel(member).getByRole('button', { name: 'Sửa tiếp nháp #1 (của E2E Super Admin)' })).toBeVisible();
    await expect(panel(member).getByRole('button', { name: /Gửi duyệt/ })).toHaveCount(0);
    await stepUpViaApi(member, memberSecret, 'diagram');
    const hijack = await member.request.post(`/api/v1/diagrams/${id}/submit`, {
      headers: await writeHeaders(member),
      data: { reason: 'Gửi hộ E2E' },
      failOnStatusCode: false,
    });
    expect(hijack.status()).toBe(403);
    expect(await hijack.json()).toMatchObject({ code: 'DIAGRAM_SUBMIT_NOT_OWN_DRAFT' });

    // Vẽ tiếp rồi lưu — bản mới là của Thành viên, gửi được.
    await save(member, id, 'Phòng E2E vẽ tiếp');
    const sent = await member.request.post(`/api/v1/diagrams/${id}/submit`, { headers: await writeHeaders(member), data: { reason: 'Vẽ xong E2E' } });
    expect(sent.status(), await sent.text()).toBe(201);
    await member.context().close();

    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    const diagramsLink = nav.getByRole('link', { name: 'Sơ đồ mạng' });
    await expect(diagramsLink).toHaveAccessibleDescription(/\d+ Bản vẽ chờ duyệt/);
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { name: /^Bản vẽ chờ duyệt · \d+$/ })).toBeVisible();
    await page.getByRole('link', { name: `Mở ${name}` }).click();
    await expect(page).toHaveURL(new RegExp(`/diagrams/${id}$`));
  });

  test('D-08: Ctrl+K tìm được bản vẽ theo tên, mở thẳng bản vẽ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const name = `E2E Tìm nhanh UX2 ${stamp}`;
    const id = await createDiagram(page, { name, nodeType: 'company' });
    await page.goto('/');
    // Ctrl+K do listener gắn lên `document` sau khi app dựng xong — gõ sớm là phím rơi mất.
    await expect(page.getByRole('navigation', { name: /Điều hướng/ })).toBeVisible();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Tìm nhanh' });
    await palette.getByRole('combobox').fill(`Tìm nhanh UX2 ${stamp}`);
    const group = palette.getByRole('group', { name: 'Sơ đồ mạng' });
    await group.getByRole('option', { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(new RegExp(`/diagrams/${id}$`));
  });
});
