import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, uniqueStamp } from './helpers';

/** UX-E30: Phần mềm (bốn màn) nhập được từ Excel — cùng sheet + cột với file Xuất của màn. */
async function xlsx(sheetName: string, rows: Record<string, string>[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  const headers = Object.keys(rows[0]);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((h) => row[h]));
  const path = join(tmpdir(), `ims-sw-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  await wb.xlsx.writeFile(path);
  return path;
}

test.describe('Phần mềm — Nhập từ Excel', () => {
  test('file mẫu Hợp đồng bảo trì nhập lại không đổi gì; thêm một hợp đồng qua file', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/maintenance');
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nhập hợp đồng bảo trì từ Excel' });
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Tải file mẫu/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('mau-hop-dong-bao-tri.xlsx');
    const saved = join(tmpdir(), `ims-sw-mau-${Date.now()}.xlsx`);
    await file.saveAs(saved);
    expect(readFileSync(saved).subarray(0, 2).toString()).toBe('PK');
    await dialog.getByLabel('Chọn file .xlsx').setInputFiles(saved);
    await expect(dialog.getByText(/Lỗi: 0/)).toBeVisible();
    await expect(dialog.getByText(/Thêm mới: 0/)).toBeVisible();

    const code = `BT-E2E-NHAP-${uniqueStamp()}`;
    await dialog.getByLabel('Chọn file .xlsx').setInputFiles(
      await xlsx('Hợp đồng bảo trì', [{ 'Mã hồ sơ': code, 'Tên': 'E2E bảo trì nhập từ file' }]),
    );
    await expect(dialog.getByText(/Thêm mới: 1/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Xác nhận ghi' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('searchbox').first().fill(code);
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  });

  test('đường hỏng: Tên miền & SSL không có cột Loại → dòng lỗi, không ghi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/domains');
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nhập tên miền & SSL từ Excel' });
    await dialog.getByLabel('Chọn file .xlsx').setInputFiles(
      await xlsx('Tên miền & SSL', [{ 'Mã hồ sơ': `SSL-E2E-NHAP-${uniqueStamp()}`, 'Tên': 'E2E' }]),
    );
    await expect(dialog.getByText(/Lỗi: 1/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();
  });
});
