import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, uniqueStamp } from './helpers';

/** UX-E30: Đường truyền nhập được từ Excel — cùng bộ cột với file Xuất. */
async function xlsx(sheetName: string, rows: Record<string, string>[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  const headers = Object.keys(rows[0]);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((h) => row[h]));
  const path = join(tmpdir(), `ims-isp-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  await wb.xlsx.writeFile(path);
  return path;
}

test.describe('Đường truyền — Nhập từ Excel', () => {
  test('file mẫu nhập lại không đổi gì; nhà mạng không có trong danh mục là dòng lỗi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/isp-lines');
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nhập đường truyền từ Excel' });
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Tải file mẫu/ }).click();
    const saved = join(tmpdir(), `ims-isp-mau-${Date.now()}.xlsx`);
    await (await download).saveAs(saved);
    expect(readFileSync(saved).subarray(0, 2).toString()).toBe('PK');
    await dialog.getByLabel('Chọn file .xlsx').setInputFiles(saved);
    await expect(dialog.getByText(/Thêm mới: 0/)).toBeVisible();
    await expect(dialog.getByText(/Cập nhật: 0/)).toBeVisible();
    await expect(dialog.getByText(/Lỗi: 0/)).toBeVisible();

    await dialog.getByLabel('Chọn file .xlsx').setInputFiles(
      await xlsx('Đường truyền', [{ 'Mã': `ISP-E2E-NHAP-${uniqueStamp()}`, 'Nhà mạng': 'Nhà mạng E2E không có' }]),
    );
    await expect(dialog.getByText(/Lỗi: 1/)).toBeVisible();
    await expect(dialog.getByText(/Nhà mạng "Nhà mạng E2E không có" không có trong danh mục/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();
  });
});
