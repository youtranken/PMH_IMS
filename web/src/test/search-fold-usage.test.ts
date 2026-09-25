import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CỔNG CHẶN CẢ LỚP LỖI B-01 Ở TẦNG TRÌNH DUYỆT, KHÔNG CHỈ SÁU CHỖ CỦA HÔM NAY.
 *
 * ===== VÌ SAO CẦN MỘT CỔNG QUÉT MÃ NGUỒN =====
 *
 * B-01 ở tầng SQL đã có hàng rào cứng: cột sinh + `searchNormLike`, sai là đỏ ngay. Tầng
 * trình duyệt thì không — ở đây lọc là `x.toLowerCase().includes(term)`, một câu ai cũng viết
 * được trong ba giây, và nó SAI IM LẶNG: màn hình vẫn chạy, vẫn hiện "Chưa có dữ liệu", chỉ
 * là không tìm ra `Thiết bị` khi người ta gõ `thiet`.
 *
 * Sáu chỗ ngày 25/09 đã sửa. Cái cần canh là chỗ thứ BẢY — màn ai đó viết tháng sau, chép
 * đúng nếp cũ từ một màn cũ. Sửa sáu chỗ mà không dựng cổng là chữa triệu chứng.
 *
 * ===== VÌ SAO CẤM ĐÚNG CHUỖI NÀY =====
 *
 * `.toLowerCase().includes(` là chữ ký của phép lọc-văn-bản-không-gấp-dấu, và nó đủ hẹp để
 * không bắt nhầm: `toLowerCase()` dùng một mình (so bằng, dựng khóa, chuẩn hóa mã) không sao,
 * `includes()` trên mảng không sao. Chỉ cặp đôi ấy mới là phép tìm kiếm.
 *
 * Cách đúng: `foldSearch()` ở CẢ HAI VẾ — vế dữ liệu và vế từ khóa.
 */

const WEB_SRC = findWebSrc();

/** Đi ngược lên tìm `web/src` — bộ kiểm chạy được từ `web/` lẫn từ gốc repo. */
function findWebSrc(): string {
  let dir = process.cwd();
  for (let up = 0; up < 5; up += 1) {
    for (const candidate of [join(dir, 'src'), join(dir, 'web', 'src')]) {
      try {
        if (statSync(candidate).isDirectory() && statSync(join(candidate, 'lib')).isDirectory()) {
          return candidate;
        }
      } catch {
        // thư mục không có ở tầng này — đi lên tiếp
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Không tìm thấy web/src từ ' + process.cwd());
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('B-01 — lọc văn bản trên trình duyệt phải gấp dấu', () => {
  it('không file nào còn `.toLowerCase().includes(`', () => {
    const files = sourceFiles(WEB_SRC);
    // Quét 0 file mà vẫn xanh là cái bẫy quen thuộc — chốt lại số lượng trước.
    expect(files.length).toBeGreaterThan(100);

    /*
     * Hai file được phép NHẮC TỚI câu bị cấm, vì công việc của chúng là nói về nó: bài kiểm
     * này (trong biểu thức tìm) và `lib/search-fold.ts` (chú thích đầu file kể lại đúng câu
     * sai mà sáu màn từng viết). Miễn theo TÊN FILE chứ không theo dòng: một dòng "cho phép"
     * đánh dấu bằng chú thích là cái cửa mà mọi vi phạm sau sẽ đi qua.
     */
    const ALLOWED = ['search-fold-usage.test.ts', join('lib', 'search-fold.ts')];
    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.some((allowed) => file.endsWith(allowed))) continue;
      const source = readFileSync(file, 'utf8');
      for (const [index, line] of source.split(/\r?\n/).entries()) {
        if (line.includes('.toLowerCase().includes(')) {
          offenders.push(`${relative(WEB_SRC, file)}:${index + 1}`);
        }
      }
    }

    expect(
      offenders,
      // Jest bên api không có tham số thứ hai này; Vitest thì có (xem memory dự án).
      'Dùng foldSearch() ở cả hai vế thay cho toLowerCase().includes() — xem src/lib/search-fold.ts',
    ).toEqual([]);
  });

  it('sáu chỗ lọc tại chỗ đều đã gọi foldSearch', () => {
    /*
     * Cổng trên chỉ nói "không còn câu SAI". Ô này nói "câu ĐÚNG đã có mặt" — hai điều khác
     * nhau: xóa hẳn phép lọc đi cũng làm cổng trên xanh.
     */
    const expected = [
      'ui/command-palette.tsx',
      'ui/suggest-input.tsx',
      'features/disposal/disposal-screen.tsx',
      'features/ipam/service-port-picker.tsx',
      'features/vault/access-matrix-screen.tsx',
      'features/vault/vault-home-screen.tsx',
    ];
    for (const rel of expected) {
      const source = readFileSync(join(WEB_SRC, rel), 'utf8');
      // So trên BOOLEAN chứ không `toContain(source)`: hỏng thì Vitest in ra cả file, và một
      // màn 300 dòng trong nhật ký lỗi che mất chính câu cần đọc.
      expect(source.includes('foldSearch'), `${rel} phải gấp dấu khi lọc`).toBe(true);
    }
  });
});
