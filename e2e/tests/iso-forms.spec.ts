import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  confirmAction,
  firstLogin,
  resetApprovals,
  resetIso,
  resetUsers,
  rowAction,
  sql,
  switchTheme,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Phiếu ISO đợt 1 — 0203 · 0206 · 0208 (Q-28, Epic 8).
 *
 * Bài kiểm chỉ ghi vào NĂM 2021 (`resetIso` hạ `iso.first_month` về 2021-01): mọi ngày đều đã
 * qua nên đánh, gửi chốt được ngay, và kỳ thật của công ty không bị chạm. Mỗi bài một tháng riêng.
 */
test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetIso();
});

type Job = { id: string; lines: { id: string }[] };

async function api(page: Page, method: string, url: string, data?: unknown) {
  return page.request.fetch(url, { method, headers: await writeHeaders(page), data });
}

async function createJob(page: Page, name: string, trackedFrom = '2021-01-01'): Promise<Job> {
  const res = await api(page, 'POST', '/api/v1/iso/catalog/jobs', {
    no: 900 + (Number(uniqueStamp()) % 99),
    name,
    trackedFrom,
    lines: [{ label: null, pointsNas: '14', storageNas: 'NAS', pointsCloud: '7', storageCloud: 'Cloud' }],
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as Job;
}

async function fillMonth(page: Page, month: string, days: number): Promise<void> {
  for (let d = 1; d <= days; d += 1) {
    const res = await api(page, 'POST', '/api/v1/iso/backup/fill-day', { day: `${month}-${String(d).padStart(2, '0')}` });
    expect(res.status()).toBe(201);
  }
}

function setOwner(form: '0203' | '0208', email: string | null): void {
  const value = email ? `(SELECT id FROM users WHERE email = '${email}')` : 'NULL';
  sql(`UPDATE iso_form_owner SET primary_user_id = ${value} WHERE form_type = '${form}'`);
}

async function typeDate(page: Page, scope: Locator, label: RegExp, ddmmyyyy: string): Promise<void> {
  await scope.getByRole('button', { name: label }).first().click();
  const typed = page.getByRole('textbox', { name: 'Gõ ngày (dd/mm/yyyy)' });
  await typed.fill(ddmmyyyy);
  await typed.press('Enter');
}

test.describe('Phiếu ISO · Epic 8', () => {
  test('sidebar: nhóm "Phiếu ISO" thu gọn mặc định, bấm mở 5 mục; đứng ở màn phiếu thì tự mở', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    const toggle = nav.getByRole('button', { name: /Phiếu ISO/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    for (const name of ['Theo dõi backup · 0203', 'Theo dõi antivirus · 0208', 'Sự cố · 0206', 'Kỳ phiếu & chốt kỳ', 'Danh mục phiếu']) {
      await expect(nav.getByRole('link', { name })).toBeVisible();
    }
    await toggle.click();
    await page.goto('/iso/antivirus?month=2021-03');
    await expect(nav.getByRole('button', { name: /Phiếu ISO/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('danh mục: thêm job có đối tượng con; tên trùng bị từ chối; ngừng theo dõi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const name = `E2E-FS-${uniqueStamp()}`;
    await page.goto('/iso/catalog');
    await page.getByRole('button', { name: '+ Thêm job' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /Name Job Backup/ }).fill(name);
    await dialog.getByRole('textbox', { name: 'Đối tượng con 1' }).fill('OS');
    await dialog.getByRole('button', { name: '+ Thêm đối tượng con' }).click();
    await dialog.getByRole('textbox', { name: 'Đối tượng con 2' }).fill('Volume_E');
    // Points chỉ nhận số; Storage location tự ghi theo Points, không phải ô nhập.
    await dialog.getByRole('textbox', { name: 'Points NAS 1' }).fill('c');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog.getByText('Points NAS và Points Cloud chỉ nhận số nguyên (0–9999).')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Points NAS 1' }).fill('14');
    await expect(dialog.getByRole('row', { name: /Đối tượng con 1/ }).getByRole('cell', { name: 'NAS', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã lưu job backup.')).toBeVisible();
    // Mỗi đối tượng con một dòng (không gộp bằng dấu phẩy), cột NAS theo cùng nhịp.
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row.getByRole('listitem').filter({ hasText: /^OS$/ })).toBeVisible();
    await expect(row.getByRole('listitem').filter({ hasText: /^Volume_E$/ })).toBeVisible();
    await expect(row.getByRole('listitem').filter({ hasText: '14 · NAS' })).toBeVisible();

    // Trùng tên trong danh sách đang theo dõi: API từ chối, câu báo tiếng Việt.
    const dup = await api(page, 'POST', '/api/v1/iso/catalog/jobs', {
      no: 998,
      name: name.toLowerCase(),
      trackedFrom: '2021-01-01',
      lines: [{ label: null, pointsNas: null, storageNas: null, pointsCloud: null, storageCloud: null }],
    });
    expect(dup.status()).toBe(409);
    expect(((await dup.json()) as { message: string }).message).toContain('trùng tên');

    await rowAction(page, name, 'Ngừng theo dõi');
    await page.getByRole('dialog').getByRole('button', { name: 'Ngừng theo dõi' }).click();
    await expect(page.getByText('Đã ngừng theo dõi job.')).toBeVisible();
  });

  test('0203: nút ✓ đầu cột, đánh ✗ một ô, lập 0206 từ ô đó qua bước Xem lại → ô có phiếu', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const name = `E2E-BK-${uniqueStamp()}`;
    await createJob(page, name);
    await page.goto('/iso/backup?month=2021-02');
    await expect(page.getByRole('heading', { name: 'Theo dõi backup · 0203' })).toBeVisible();

    await page.getByRole('button', { name: 'Đánh ✓ mọi ô trống ngày 01/02' }).click();
    await expect(page.getByRole('button', { name: `${name} ngày 1: Đạt` })).toBeVisible();

    await page.getByRole('button', { name: `${name} ngày 2: Bỏ sót — chưa đánh` }).click();
    const picker = page.getByRole('region', { name: 'Ô đang chọn' });
    await picker.getByRole('button', { name: '✗ Lỗi' }).click();
    await expect(page.getByRole('button', { name: `${name} ngày 2: Lỗi, chưa có 0206` })).toBeVisible();

    await page.getByRole('button', { name: `${name} ngày 2: Lỗi, chưa có 0206` }).click();
    await page.getByRole('region', { name: 'Ô đang chọn' }).getByRole('link', { name: 'Lập 0206 cho ô này ›' }).click();
    await expect(page.getByRole('heading', { name: 'Lập phiếu sự cố 0206' })).toBeVisible();
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Backup' })).toBeChecked();

    await page.getByLabel('Giờ phát hiện').fill('02:10');
    await page.getByRole('radio', { name: 'Medium' }).click();
    await page.getByRole('radio', { name: 'Resolved' }).click();
    await typeDate(page, page.locator('main'), /^Resolution Time/, '02/02/2021');
    await page.getByLabel('Giờ khắc phục').fill('09:30');
    await page.getByLabel(/^Incident Description/).fill('E2E job lỗi VSS writer');
    await page.getByLabel(/^Corrective Action/).fill('Chạy lại thủ công, thành công');
    await page.getByRole('button', { name: 'Xem lại trước khi lưu ›' }).click();

    // Bước Xem lại: bản phiếu dạng giấy, số phiếu CHƯA cấp và không in lên giấy.
    const paper = page.getByRole('region', { name: 'SP-IT0206' });
    await expect(paper.getByText('Daily Incident Report Form')).toBeVisible();
    await expect(paper.getByText('0206-2021-')).toHaveCount(0);
    await page.getByRole('button', { name: 'Xác nhận lưu phiếu' }).click();
    await expect(page.getByText(/Đã lưu 0206-2021-\d{3}\./)).toBeVisible();

    await page.goto('/iso/backup?month=2021-02');
    await expect(page.getByRole('button', { name: `${name} ngày 2: Lỗi, đã có 0206` })).toBeVisible();
  });

  test('0203: Member không phụ trách chỉ xem — không có nút, gọi thẳng API bị 403', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    setOwner('0203', null);
    await page.goto('/iso/backup?month=2021-02');
    await expect(page.getByText('Phiếu 0203 chưa có người phụ trách')).toBeVisible();
    await expect(page.getByRole('button', { name: /Đánh ✓ mọi ô trống/ })).toHaveCount(0);
    const res = await api(page, 'POST', '/api/v1/iso/backup/fill-day', { day: '2021-02-03' });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('ISO_NOT_OWNER');
  });

  test('0203: Member được gán phụ trách thì đánh được', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    setOwner('0203', E2E_MEMBER.email);
    const name = `E2E-OWN-${uniqueStamp()}`;
    await createJob(page, name);
    await page.goto('/iso/backup?month=2021-05');
    await page.getByRole('button', { name: 'Đánh ✓ mọi ô trống ngày 03/05' }).click();
    await expect(page.getByRole('button', { name: `${name} ngày 3: Đạt` })).toBeVisible();
  });

  test('0208: ngày không có issue, ghi issue kèm bộ phận mới tại chỗ, lưới có dòng bộ phận và Other Division', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    await page.goto('/iso/antivirus?month=2021-03');
    await expect(page.getByRole('heading', { name: 'Theo dõi antivirus · 0208' })).toBeVisible();
    await page.getByRole('button', { name: '✓ 01/03 không có issue' }).click();
    await expect(page.getByRole('button', { name: '✓ 01/03 không có issue' })).toHaveCount(0);

    await page.getByRole('button', { name: '+ Ghi máy có issue' }).click();
    const dialog = page.getByRole('dialog');
    await typeDate(page, dialog, /^Reported Date/, '02/03/2021');
    await dialog.getByRole('button', { name: 'Division', exact: true }).click();
    await page.getByRole('option', { name: '+ Bộ phận mới' }).click();
    await dialog.getByRole('textbox', { name: /Tên bộ phận mới/ }).fill(`E2E Division ${stamp}`);
    await dialog.getByRole('textbox', { name: /Computer Name/ }).fill(`E2E-PC-${stamp}`);
    await dialog.getByRole('textbox', { name: /Incident Description/ }).fill('Trojan.Gen đã cách ly');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã ghi dòng issue.')).toBeVisible();

    const grid = page.getByRole('table');
    await expect(grid.getByRole('cell', { name: `E2E Division ${stamp}` })).toBeVisible();
    await expect(grid.getByRole('cell', { name: 'Other Division' })).toBeVisible();
    await expect(grid.getByRole('row', { name: new RegExp(`E2E-PC-${stamp}`) }).getByRole('link', { name: 'Lập 0206 ›' })).toBeVisible();
  });

  test('gửi chốt: còn ô trống thì khoá nút và API từ chối; đủ thì gửi → Chờ duyệt → SA tự duyệt → khoá, bản in A3', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const name = `E2E-CL-${uniqueStamp()}`;
    await createJob(page, name);
    await fillMonth(page, '2021-04', 29);

    await page.goto('/iso/periods/0203/2021-04/review');
    await expect(page.getByText('Còn 1 ô chưa có kết quả')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gửi chốt phiếu tháng 04/2021' })).toBeDisabled();
    const early = await api(page, 'POST', '/api/v1/iso/periods/0203/2021-04/submit');
    expect(early.status()).toBe(400);
    expect(((await early.json()) as { code: string }).code).toBe('ISO_PERIOD_CHECK_FAILED');

    await fillMonth(page, '2021-04', 30);
    await page.reload();
    await expect(page.getByText('Đủ ngày, không còn ô bỏ sót')).toBeVisible();
    // Bản in A3: header mẫu SP-IT0203, Check Date là ngày cuối kỳ.
    const paper = page.getByRole('region', { name: 'SP-IT0203' });
    await expect(paper.getByText('System Data Checklist & Storage Record Form')).toBeVisible();
    await expect(paper.getByText('30 / 04 / 2021')).toBeVisible();
    await page.getByRole('button', { name: 'Gửi chốt phiếu tháng 04/2021' }).click();
    await confirmAction(page, 'Gửi chốt phiếu tháng 04/2021');
    await expect(page.getByText('Đã gửi chốt kỳ — đang chờ SA/Admin duyệt.')).toBeVisible();

    // Từ Chờ duyệt mọi ô bị khoá ở API, không chỉ ở giao diện.
    const locked = await api(page, 'PUT', '/api/v1/iso/backup/ticks', {
      lineId: ((await (await api(page, 'GET', '/api/v1/iso/backup/2021-04')).json()) as { rows: { lineId: string }[] }).rows[0].lineId,
      day: '2021-04-05',
      result: 'fail',
    });
    expect(locked.status()).toBe(409);

    await page.getByRole('button', { name: 'Duyệt chốt' }).click();
    await confirmAction(page, 'Duyệt chốt');
    await expect(page.getByText('Đã duyệt chốt kỳ.')).toBeVisible();
    await page.goto('/iso/backup?month=2021-04');
    await expect(page.getByText(/Kỳ 04\/2021 · Đã chốt · chờ bản ký · chỉ xem/)).toBeVisible();
    await expect(page.getByRole('button', { name: `${name} ngày 5: Đạt` })).toHaveCount(0);
  });

  test('bản ký và mở lại: tải bản ký → Hoàn tất; xin mở lại kèm lý do → SA duyệt → Đang ghi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await createJob(page, `E2E-SG-${uniqueStamp()}`);
    await fillMonth(page, '2021-06', 30);
    // Bản ký trước khi khoá bị từ chối (tạo kỳ bằng một lượt gửi rồi thử tải ngay).
    expect((await api(page, 'POST', '/api/v1/iso/periods/0203/2021-06/submit')).status()).toBe(201);
    expect((await api(page, 'POST', '/api/v1/iso/periods/0203/2021-06/approve', {})).status()).toBe(201);

    await page.goto('/iso/periods?month=2021-06');
    const card = page.getByRole('article', { name: '0203 · Backup' });
    await expect(card.getByText('Đã chốt · chờ bản ký').first()).toBeVisible();
    const pdf = join(tmpdir(), `ky-E2E-${uniqueStamp()}.pdf`);
    writeFileSync(pdf, '%PDF-1.4\n%%EOF\n');
    await card.getByLabel('Chọn file để đính kèm').setInputFiles(pdf);
    await expect(card.getByText('Hiện hành')).toBeVisible();
    await expect(card.getByText('Hoàn tất').first()).toBeVisible();

    await card.getByRole('button', { name: 'Xin mở lại…' }).click();
    const ask = page.getByRole('dialog');
    await ask.getByRole('textbox', { name: /Lý do/ }).fill('Ngày 14 tick nhầm');
    await ask.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    await expect(page.getByText('Đã gửi yêu cầu mở lại.')).toBeVisible();
    await card.getByRole('button', { name: 'Duyệt mở lại' }).click();
    await confirmAction(page, 'Duyệt mở lại');
    await expect(page.getByText('Đã mở lại kỳ.')).toBeVisible();
    await expect(card.getByText('Đang ghi').first()).toBeVisible();
  });

  test('0206 của kỳ Chờ duyệt chỉ xem: màn báo kỳ đang chờ duyệt, gọi thẳng API sửa bị 409', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const job = await createJob(page, `E2E-RVW-${uniqueStamp()}`);
    const lineId = job.lines[0].id;
    await fillMonth(page, '2021-09', 30);
    expect((await api(page, 'PUT', '/api/v1/iso/backup/ticks', { lineId, day: '2021-09-05', result: 'fail' })).status()).toBe(200);
    const content = {
      reportedOn: '2021-09-05',
      kind: 'backup',
      detectedAt: '2021-09-05T01:00:00.000Z',
      resolvedAt: '2021-09-05T03:00:00.000Z',
      severity: 'low',
      status: 'resolved',
      description: 'E2E job lỗi VSS',
      correctiveAction: 'Chạy lại',
      backupDetails: [],
      cells: [{ form: '0203', lineId, day: '2021-09-05' }],
    };
    const created = await api(page, 'POST', '/api/v1/iso/incidents', content);
    expect(created.status(), await created.text()).toBe(201);
    const { id, code } = (await created.json()) as { id: string; code: string };
    expect((await api(page, 'POST', '/api/v1/iso/periods/0203/2021-09/submit')).status()).toBe(201);

    await page.goto(`/iso/incidents/${id}`);
    await expect(page.getByRole('heading', { name: `Phiếu ${code}` })).toBeVisible();
    await expect(page.getByText('Kỳ của phiếu đang chờ SA/Admin duyệt — chỉ xem.', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Chọn file để đính kèm')).toHaveCount(0);
    const res = await api(page, 'PATCH', `/api/v1/iso/incidents/${id}`, { ...content, description: 'E2E sửa khi chờ duyệt' });
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('ISO_INCIDENT_IN_REVIEW');
  });

  test('bản ký: Member không phụ trách không thấy ô tải lên, gọi thẳng API bị 403', async ({ page, browser }) => {
    await firstLogin(page, E2E_SA);
    setOwner('0203', null);
    await createJob(page, `E2E-SN-${uniqueStamp()}`);
    await fillMonth(page, '2021-07', 31);
    expect((await api(page, 'POST', '/api/v1/iso/periods/0203/2021-07/submit')).status()).toBe(201);
    expect((await api(page, 'POST', '/api/v1/iso/periods/0203/2021-07/approve', {})).status()).toBe(201);
    const periodId = ((await (await api(page, 'GET', '/api/v1/iso/periods/0203/2021-07')).json()) as { periodId: string }).periodId;

    const memberCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const member = await memberCtx.newPage();
    await firstLogin(member, E2E_MEMBER);
    await member.goto('/iso/periods?month=2021-07');
    const card = member.getByRole('article', { name: '0203 · Backup' });
    await expect(card.getByText('Đã chốt · chờ bản ký').first()).toBeVisible();
    await expect(card.getByLabel('Chọn file để đính kèm')).toHaveCount(0);

    // Dựng lại đòn: Member xem được kỳ nên trước đây tải thẳng được bản ký và đẩy kỳ sang Hoàn tất.
    const res = await member.request.post('/api/v1/files', {
      headers: await writeHeaders(member),
      multipart: {
        ownerType: 'iso_period',
        ownerId: periodId,
        file: { name: 'ky-E2E.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
      },
    });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('ISO_NOT_OWNER');
    await memberCtx.close();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`màu trạng thái lưới 0203 đọc được ở giao diện ${theme === 'light' ? 'sáng' : 'tối'}`, async ({ page }) => {
      await firstLogin(page, E2E_SA);
      const job = await createJob(page, `E2E-TH-${uniqueStamp()}`);
      await api(page, 'PUT', '/api/v1/iso/backup/ticks', { lineId: job.lines[0].id, day: '2021-07-01', result: 'ok' });
      await api(page, 'PUT', '/api/v1/iso/backup/ticks', { lineId: job.lines[0].id, day: '2021-07-02', result: 'fail' });
      await page.goto('/iso/backup?month=2021-07');
      await switchTheme(page, theme);
      const ok = page.getByRole('button', { name: /ngày 1: Đạt/ });
      const fail = page.getByRole('button', { name: /ngày 2: Lỗi, chưa có 0206/ });
      await expect(ok).toBeVisible();
      await expect(fail).toBeVisible();
      const [okColor, failColor] = await Promise.all([ok.evaluate((el) => getComputedStyle(el).color), fail.evaluate((el) => getComputedStyle(el).color)]);
      expect(okColor).not.toBe(failColor);
    });
  }
});
