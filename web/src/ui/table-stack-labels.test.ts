import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { quetNguon } from '@/test/quet-nguon';

/**
 * Ô THAO TÁC của bảng `.table-stack` phải mang `data-label` (UX-DR2).
 *
 * Dưới 961px `.table-stack` gập mỗi dòng thành một thẻ dọc và lấy `data-label` làm nhãn bên
 * trái của từng ô (`css/detail-tabs.css`). Ô không nhãn thì nút ba chấm trôi lơ lửng ở mép phải
 * thẻ, không có chữ nào nói nó là gì — ở 390px đó là nút duy nhất để sửa/xoá dòng đó.
 *
 * Chỉ quét ô chứa nút thao tác (`action-cell` / `RowActions`): ô giá trị của bảng khoá–giá trị
 * (`<th scope="row">` + `<td>`) đã có tên ở chính ô `th`, gắn thêm nhãn là đọc hai lần.
 */
const SRC = join(__dirname, '..');

function actionCellsWithoutLabel(): string[] {
  const out: string[] = [];
  for (const file of quetNguon(SRC, /\.tsx$/)) {
    if (/\.test\.tsx$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    if (!source.includes('table-stack')) continue;
    for (const match of source.matchAll(/<td>/g)) {
      const start = match.index ?? 0;
      const cell = source.slice(start, source.indexOf('</td>', start));
      if (/action-cell|<RowActions/.test(cell)) {
        const line = source.slice(0, start).split('\n').length;
        out.push(`${relative(SRC, file).replace(/\\/g, '/')}:${line}`);
      }
    }
  }
  return out;
}

describe('Bảng gập thẻ ở điện thoại — ô Thao tác có nhãn', () => {
  it('không còn ô thao tác nào thiếu data-label', () => {
    expect(actionCellsWithoutLabel()).toEqual([]);
  });
});
