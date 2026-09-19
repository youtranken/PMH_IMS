/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ĐIỂM DANH: `vi.ts` không được chứa khóa mà không nơi nào dùng.
 *
 * ===== VÌ SAO LÀ MỘT BÀI KIỂM, KHÔNG PHẢI MỘT LẦN DỌN =====
 *
 * Lượt rà 12/09 đếm được 46 khóa chết; đo lại sau bốn đợt vá thì con số ấy đã sai, vì chính
 * bốn đợt đó vừa xoá một loạt khóa và vừa làm SỐNG LẠI hai khóa (`app.serverUnreachable`,
 * `accounts.disable`). Một lần xoá tay chỉ đúng cho hôm nay: khóa chết sinh ra mỗi lần ai đó
 * đổi câu chữ rồi quên dòng cũ, và chuyện đó xảy ra ở mọi story.
 *
 * Khóa chết không làm hỏng gì, và đó chính là vấn đề: nó làm `vi.ts` dài ra, làm người dịch
 * sau không biết câu nào còn dùng, và làm chỗ sửa-sai-một-câu thành chỗ phải đọc ba câu để
 * chọn. Nên thứ đáng dựng là cái cửa, không phải cái lần dọn.
 *
 * ===== BA CÁCH MỘT KHÓA ĐƯỢC DÙNG =====
 *
 * Bài này phải nhận ra cả ba, nếu không nó sẽ báo động giả và rồi người ta tắt nó đi:
 *   1. viết thẳng — `t('devices.code')`
 *   2. dựng động theo TIỀN TỐ — `` t(`vault.tierNote_${tier}`) `` phủ ba khóa `tierNote_*`
 *   3. dựng động theo HẬU TỐ — `` t(`history.${mod}.actCreated`) `` phủ sáu sổ
 *
 * Nhận sai cách 2 và 3 là cách nhanh nhất để bài này thành vô dụng.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

/**
 * Khóa ĐƯỢC PHÉP không ai dùng, kèm lý do. Cùng lối với `MAY_GROW` ở `e2e/leak-guard.ts`:
 * kể tên ngoại lệ ra giấy, thay vì nới vị từ cho tới khi bài hết đỏ.
 *
 * Danh sách này đang RỖNG, và giữ được như vậy là điều đáng giá. Thêm một dòng vào đây phải
 * giải thích được trong PR — "sẽ dùng ở story sau" là lý do hợp lệ, "không biết tại sao còn"
 * thì không: cái đó nghĩa là xoá được.
 */
const DUOC_PHEP_KHONG_DUNG: Record<string, string> = {};

function moiFile(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    /*
     * BỎ QUA THƯ MỤC DÒ CỦA `lint-rules.test.ts` (18/09/2026).
     *
     * Bài đó `mkdtempSync(join(WEB_ROOT, under, '__lint-probe__'))` để thử xem luật eslint có
     * bắt được một file vi phạm không, rồi xoá đi. Vitest chạy các file test SONG SONG, nên
     * bài này có thể liệt kê được thư mục ấy rồi 20ms sau đọc phải một đường dẫn đã biến mất:
     *
     *   ENOENT: open 'web/src/__lint-probe__E1j2jq/probe.tsx'
     *
     * Đỏ CẢ FILE chứ không đỏ một assertion nào — nên nó trông như hỏng hệ thống, và người
     * đọc log sẽ đi tìm ở nhầm chỗ. Lượt chạy 18/09 vấp đúng cảnh này.
     *
     * Bỏ qua theo TÊN thay vì bọc `try/catch` quanh `readFileSync`: nuốt ENOENT là nuốt luôn
     * mọi lỗi đọc thật, và bài này sống bằng việc đọc được HẾT mọi file nguồn — sót một file
     * là một khóa dịch bị kết luận nhầm là chết.
     */
    if (e.isDirectory()) return e.name.startsWith('__lint-probe__') ? [] : moiFile(full);
    if (!e.isFile()) return [];
    return /\.tsx?$/.test(e.name) && e.name !== 'vi.ts' ? [full] : [];
  });
}

/** Mọi khóa LÁ của `vi.ts`, dạng `a.b.c`. Đọc bằng thụt lề chứ không `import` — xem chú thích. */
function khoaCuaViTs(): string[] {
  /*
   * Vì sao đọc VĂN BẢN chứ không `import vi from './vi'`: import cho ta object, mà object thì
   * không phân biệt được "khóa lá" với "namespace" khi có namespace chỉ chứa một khóa. Đọc
   * theo dòng thì cấu trúc `vi.ts` nói thẳng điều đó ra.
   */
  const source = readFileSync(join(HERE, 'vi.ts'), 'utf8');
  const khoa: string[] = [];
  const duong: string[] = [];
  for (const line of source.split('\n')) {
    const st = line.trim();
    const moNamespace = /^([A-Za-z_][A-Za-z0-9_]*): \{$/.exec(st);
    if (moNamespace) {
      duong.push(moNamespace[1]);
      continue;
    }
    if (st.startsWith('},') || st === '}' || st === '} as const;') {
      duong.pop();
      continue;
    }
    const laKhoa = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(st);
    if (laKhoa && duong.length > 0) khoa.push([...duong, laKhoa[1]].join('.'));
  }
  return khoa;
}

describe('Khóa dịch chết trong vi.ts', () => {
  const khoa = khoaCuaViTs();
  /*
   * LỘT CHÚ THÍCH, VÀ BỎ FILE KIỂM, TRƯỚC KHI DÒ (19/09/2026).
   *
   * Phép "có ai dùng không" là `nguon.includes("'khóa'")` trên VĂN BẢN THÔ, nên một khóa chỉ
   * được NHẮC TỚI trong một dòng chú thích — hoặc chỉ còn sống trong một file `*.test.tsx` —
   * vẫn được tính là còn người dùng. Đợt rà 19/09 chứng minh bằng đột biến: chèn 2 khóa chết,
   * bài đỏ cả 2; thêm một dòng chú thích nhắc tên khóa thứ hai vào `ui/tabs.tsx`, bài chỉ còn
   * đỏ 1. Lỗ ấy chưa nuôi khóa chết nào (đo lại sau khi lột: 0 khóa chênh lệch), nên đây là
   * bịt lỗ chứ không phải trả nợ.
   *
   * Vì sao bỏ file kiểm: một khóa mà NƠI DÙNG DUY NHẤT là bài kiểm của chính nó thì nó đã
   * chết trong sản phẩm — đúng thứ bài này sinh ra để tìm.
   */
  const nguon = moiFile(SRC)
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .map((noiDung) =>
      noiDung.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1'),
    )
    .join('\n');

  /* Tiền tố của mọi khóa dựng động: `` `abc.def_${…}` `` → 'abc.def_'. */
  const tienTo = new Set(
    [...nguon.matchAll(/[`]([A-Za-z0-9_.]*?)\$\{/g)].map((m) => m[1]).filter(Boolean),
  );
  /* Hậu tố khi phần đầu là biến: `` `${mod}.actCreated` `` → 'actCreated'. */
  const hauTo = new Set([...nguon.matchAll(/\$\{[^}]*\}\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));

  /*
   * SÀN CHỐNG ĐỌC HỤT. Đổi cách viết `vi.ts` (thụt lề khác, gộp một dòng) làm `khoaCuaViTs`
   * trả về rỗng, và một bài "mọi khóa tìm được đều có người dùng" sẽ XANH RỰC trong khi nó
   * chẳng kiểm gì. 1000 là mức sàn thô dưới con số đo được ngày 12/09 (1067).
   */
  it('đọc được vi.ts (nếu không thì cả bài này vô nghĩa)', () => {
    expect(khoa.length).toBeGreaterThanOrEqual(1000);
  });

  it('mọi khóa đều có nơi dùng', () => {
    const chet = khoa.filter((k) => {
      if (k in DUOC_PHEP_KHONG_DUNG) return false;
      if (nguon.includes(`'${k}'`) || nguon.includes(`"${k}"`)) return false;
      for (const t of tienTo) if (k.startsWith(t)) return false;
      return !hauTo.has(k.split('.').pop() as string);
    });
    // Vitest in nguyên mảng khi đỏ, nên người đọc thấy luôn khóa nào cần xoá.
    expect(chet).toEqual([]);
  });
});
