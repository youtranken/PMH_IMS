import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CỔNG CHẶN: đăng xuất chỉ được đi qua MỘT cửa — `logout()` trong `helpers.ts`.
 *
 * ===== VÌ SAO CÓ BÀI NÀY =====
 *
 * `break-glass.spec.ts` chập chờn suốt nhiều lượt chạy đầy đủ, và nguyên nhân hoá ra không nằm
 * ở break-glass chút nào. Nút "Đăng xuất" chỉ bắn `POST /auth/logout` rồi mới điều hướng trong
 * `onSuccess`. Bấm xong mà đi tiếp ngay — mà bước tiếp theo của mọi bài kiểm là `fillLogin`,
 * tức `page.goto('/login')` — thì điều hướng HỦY luôn request đang bay. Phiên cũ sống sót,
 * `AppRoutes` đá màn đăng nhập về `/`, và bài kiểm chờ ô Email trên màn đã đăng nhập tới hết
 * 60 giây rồi đỏ ở `locator.fill`: một chỗ không liên quan gì tới điều nó đang kiểm.
 *
 * Mỗi spec bấm thẳng nút đó, hoặc giữ bản chép riêng của `logout()`, là thêm một chỗ mang
 * cùng cuộc đua — và chỉ chỗ nào tình cờ thua đủ thường xuyên mới bị chú ý. Sửa một chỗ thì
 * mọi chỗ kia vẫn ngồi đó chờ tới lượt.
 *
 * Cổng này khoá lại đúng điều đó: sửa `helpers.logout()` là sửa cho tất cả, và không ai mở
 * được cửa thứ hai mà không đọc dòng chữ này trước.
 */
test.describe('Đăng xuất đi qua một cửa duy nhất', () => {
  // `__dirname` KHÔNG tồn tại — gói này là ESM (`"type": "module"`). Xem đầu `tsconfig.json`.
  const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
  const SELF = 'logout-single-path.spec.ts';
  // Ghép từ mảnh để chính file này không tự khớp vào luật của mình.
  const BUTTON = ['getByRole(', "'button'"].join('');
  const LABEL = 'Đăng' + ' xuất';

  function otherSpecs(): string[] {
    return readdirSync(TESTS_DIR).filter((f) => f.endsWith('.spec.ts') && f !== SELF);
  }

  function read(file: string): string {
    // Chuẩn hoá xuống dòng: repo này lưu CRLF, mọi phép cắt bên dưới giả định LF.
    return readFileSync(join(TESTS_DIR, file), 'utf8').replace(/\r\n/g, '\n');
  }

  test('không spec nào bấm thẳng nút Đăng xuất', () => {
    const offenders: string[] = [];
    for (const file of otherSpecs()) {
      read(file)
        .split('\n')
        .forEach((line, i) => {
          // Khớp ĐÚNG nhãn "Đăng xuất" ('…' hoặc /…/), không khớp chuỗi con: "Đăng xuất phiên"
          // ở màn Hồ sơ là ĐÓNG MỘT PHIÊN, một việc khác hẳn rời khỏi ứng dụng.
          const exact = line.includes(`'${LABEL}'`) || line.includes(`/${LABEL}/`) || line.includes(`/^${LABEL}$/`);
          if (line.includes(BUTTON) && exact) {
            offenders.push(`${file}:${i + 1} → ${line.trim()}`);
          }
        });
    }
    expect(
      offenders,
      'bấm thẳng nút là bỏ mất bước chờ phản hồi — dùng `logout(page)` của helpers.ts',
    ).toEqual([]);
  });

  test('không spec nào giữ bản chép riêng của logout()', () => {
    const offenders = otherSpecs().filter((file) => /(async )?function logout\s*\(/.test(read(file)));
    expect(offenders, 'AD-15: một hành vi một bản — sửa `helpers.logout()`').toEqual([]);
  });

  /**
   * Tự canh chính mình. Hai bài trên vẫn xanh y nguyên nếu ai đó gỡ bước chờ khỏi `logout()`
   * — lúc đó cổng còn đứng đó nhưng đã hết tác dụng, kiểu hỏng tệ nhất của một cổng chặn.
   */
  test('helpers.logout() thật sự CHỜ phản hồi đăng xuất', () => {
    const src = read('helpers.ts');
    const body = src.slice(src.indexOf('export async function logout('));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    expect(fn.length, 'không cắt được thân hàm logout() — cổng này đang mù').toBeGreaterThan(100);
    expect(fn, 'phải giữ phản hồi lại trước khi rời hàm').toContain('waitForResponse');
    expect(fn, 'phải chờ đúng endpoint đăng xuất').toContain('/api/v1/auth/logout');
  });
});
