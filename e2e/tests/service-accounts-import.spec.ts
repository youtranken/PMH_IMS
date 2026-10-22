import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, uniqueStamp } from './helpers';

/** UX-E30: Tài khoản dịch vụ nhập được từ Excel — cùng bộ cột với file Xuất. */
async function xlsx(sheetName: string, rows: Record<string, string>[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  const headers = Object.keys(rows[0]);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((h) => row[h]));
  const path = join(tmpdir(), `ims-sa-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  await wb.xlsx.writeFile(path);
  return path;
}

test.describe('Tài khoản dịch vụ — Nhập từ Excel', () => {
  test('file mẫu nhập lại không đổi gì; thêm một tài khoản mới qua file', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/service-accounts');
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nhập tài khoản dịch vụ từ Excel' });
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Tải file mẫu/ }).click();
    const saved = join(tmpdir(), `ims-sa-mau-${Date.now()}.xlsx`);
    await (await download).saveAs(saved);
    expect(readFileSync(saved).subarray(0, 2).toString()).toBe('PK');
    await dialog.getByLabel('Chọn file .xlsx').setInputFiles(saved);
    await expect(dialog.getByText(/Thêm mới: 0/)).toBeVisible();
    await expect(dialog.getByText(/Cập nhật: 0/)).toBeVisible();
    await expect(dialog.getByText(/Lỗi: 0/)).toBeVisible();

    const code = `TK-E2E-NHAP-${uniqueStamp()}`;
    await dialog.getByLabel('Chọn file .xlsx').setInputFiles(
      await xlsx('Tài khoản dịch vụ', [{ 'Mã': code, 'Tên': 'E2E nhập từ file', 'Loại': 'Dùng chung', 'Tên đăng nhập': 'e2e-nhap' }]),
    );
    await expect(dialog.getByText(/Thêm mới: 1/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Xác nhận ghi' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('searchbox').first().fill(code);
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  });

  test('đường hỏng: file không có sheet "Tài khoản dịch vụ" → nói rõ, không ghi gì', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/service-accounts');
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nhập tài khoản dịch vụ từ Excel' });
    await dialog.getByLabel('Chọn file .xlsx').setInputFiles(await xlsx('Sheet1', [{ 'Mã': 'TK-E2E-SAI', 'Loại': 'VPN' }]));
    await expect(dialog.getByText(/không có sheet nào tên "Tài khoản dịch vụ"/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();
  });
});
