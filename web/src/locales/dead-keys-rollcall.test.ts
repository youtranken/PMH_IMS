/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanSource } from '@/test/scan-source';

/**
 * ĐIỂM DANH: `vi.ts` không được chứa khóa mà không nơi nào dùng.
 *
 * ===== VÌ SAO LÀ MỘT BÀI KIỂM, KHÔNG PHẢI MỘT LẦN DỌN =====
 *
 * Một lần xoá tay chỉ đúng cho hôm nay: khóa chết sinh ra mỗi lần ai đó đổi câu chữ rồi quên
 * dòng cũ, và một khóa đã xoá cũng có thể SỐNG LẠI khi có người dùng lại nó
 * (`app.serverUnreachable`, `accounts.disable` từng như thế).
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
const ALLOWED_UNUSED: Record<string, string> = {};

/**
 * Khóa mà một template RỘNG (`` t(`ns.${bien}`) ``) thật sự dựng ra.
 *
 * Khai tay vì bộ quét cố ý không cứu theo tiền tố phủ cả namespace — xem chú thích ở chỗ
 * dựng `prefixes`. Thêm nhánh mới cho `ipCheck.reason` hay `done` thì thêm dòng ở đây; quên
 * thì bài này đỏ, và đỏ đúng chỗ.
 */
const KEYS_USED_DYNAMICALLY = new Set<string>([
  // `features/ipam/nat-screen.tsx` — `` t(`nat.${ipCheck.reason}`) ``
  'nat.internalIpRequired',
  'nat.internalIpNotOfTarget',
  // `features/service-accounts/service-accounts-screen.tsx` — `` t(`serviceAccounts.${done}`) ``
  'serviceAccounts.disabled',
  'serviceAccounts.enabled',
]);

/*
 * DÙNG BẢN CHUNG `scanSource` — luật bỏ qua `__lint-probe__*` (tránh cuộc đua ENOENT với thư
 * mục probe của bài lint đang chạy song song) sống ở MỘT chỗ. Đừng chép lại phép quét cây ở đây.
 *
 * `vi.ts` lọc SAU khi quét chứ không nhét vào `scanSource`: đó là luật riêng của bài này (không
 * đếm chính file khai khóa là "nơi dùng khóa"), không phải luật chung của phép quét cây.
 */
function allFiles(dir: string): string[] {
  return scanSource(dir, /\.tsx?$/).filter((f) => !f.endsWith('vi.ts'));
}

/** Mọi khóa LÁ của `vi.ts`, dạng `a.b.c`. Đọc bằng thụt lề chứ không `import` — xem chú thích. */
function viTsKeys(): string[] {
  /*
   * Vì sao đọc VĂN BẢN chứ không `import vi from './vi'`: import cho ta object, mà object thì
   * không phân biệt được "khóa lá" với "namespace" khi có namespace chỉ chứa một khóa. Đọc
   * theo dòng thì cấu trúc `vi.ts` nói thẳng điều đó ra.
   */
  const source = readFileSync(join(HERE, 'vi.ts'), 'utf8');
  const key: string[] = [];
  const route: string[] = [];
  for (const line of source.split('\n')) {
    const st = line.trim();
    const namespaceOpen = /^([A-Za-z_][A-Za-z0-9_]*): \{$/.exec(st);
    if (namespaceOpen) {
      route.push(namespaceOpen[1]);
      continue;
    }
    if (st.startsWith('},') || st === '}' || st === '} as const;') {
      route.pop();
      continue;
    }
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(st);
    if (keyMatch && route.length > 0) key.push([...route, keyMatch[1]].join('.'));
  }
  return key;
}

describe('Khóa dịch chết trong vi.ts', () => {
  const key = viTsKeys();
  /*
   * LỘT CHÚ THÍCH, VÀ BỎ FILE KIỂM, TRƯỚC KHI DÒ.
   *
   * Phép "có ai dùng không" là `nguon.includes("'khóa'")` trên VĂN BẢN THÔ, nên một khóa chỉ
   * được NHẮC TỚI trong một dòng chú thích — hoặc chỉ còn sống trong một file `*.test.tsx` —
   * vẫn được tính là còn người dùng. Đột biến chứng minh: chèn 2 khóa chết, bài đỏ cả 2; thêm
   * một dòng chú thích nhắc tên khóa thứ hai vào `ui/tabs.tsx`, bài chỉ còn đỏ 1.
   *
   * Vì sao bỏ file kiểm: một khóa mà NƠI DÙNG DUY NHẤT là bài kiểm của chính nó thì nó đã
   * chết trong sản phẩm — đúng thứ bài này sinh ra để tìm.
   */
  const sourceText = allFiles(SRC)
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .map((content) =>
      content.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1'),
    )
    .join('\n');

  /*
   * Tiền tố của mọi khóa dựng động: `` `abc.def_${…}` `` → 'abc.def_'.
   *
   * ===== TIỀN TỐ PHỦ CẢ NAMESPACE BỊ TỪ CHỐI =====
   *
   * Luật cứu-theo-tiền-tố có một lỗ: hai template trong repo rộng đến mức phủ trọn một
   * namespace —
   *
   *   · `features/ipam/nat-screen.tsx:503`            → `` t(`nat.${ipCheck.reason}`) ``
   *   · `features/service-accounts/…-screen.tsx:298`  → `` t(`serviceAccounts.${done}`) ``
   *
   * Tiền tố chúng sinh ra là `'nat.'` và `'serviceAccounts.'`, và `k.startsWith(t)` vì thế
   * cứu **118 khóa** (60 + 58) khỏi mọi phép kiểm. Thực tế mỗi template chỉ dùng HAI khóa.
   * Đo được hậu quả: 8 khóa chết sống sót qua cổng này.
   *
   * Nên: tiền tố kết thúc bằng `.` KHÔNG được tự động cứu ai. Khóa mà template rộng thật sự
   * dùng thì khai tay ở `KEYS_USED_DYNAMICALLY` — danh sách ngắn, đọc được, và khi thêm nhánh mới
   * cho `ipCheck.reason` thì phải khai, đúng như khi thêm một khóa thường.
   */
  const prefixes = new Set(
    [...sourceText.matchAll(/[`]([A-Za-z0-9_.]*?)\$\{/g)]
      .map((m) => m[1])
      .filter((t) => t && !t.endsWith('.')),
  );
  /* Hậu tố khi phần đầu là biến: `` `${mod}.actCreated` `` → 'actCreated'. */
  const suffixes = new Set([...sourceText.matchAll(/\$\{[^}]*\}\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));

  /*
   * SÀN CHỐNG ĐỌC HỤT. Đổi cách viết `vi.ts` (thụt lề khác, gộp một dòng) làm `viTsKeys`
   * trả về rỗng, và một bài "mọi khóa tìm được đều có người dùng" sẽ XANH RỰC trong khi nó
   * chẳng kiểm gì. 1000 là mức sàn thô, dưới số khóa thật của `vi.ts` (hơn một nghìn).
   */
  it('đọc được vi.ts (nếu không thì cả bài này vô nghĩa)', () => {
    expect(key.length).toBeGreaterThanOrEqual(1000);
  });

  it('mọi khóa đều có nơi dùng', () => {
    const dead = key.filter((k) => {
      if (k in ALLOWED_UNUSED) return false;
      if (KEYS_USED_DYNAMICALLY.has(k)) return false;
      if (sourceText.includes(`'${k}'`) || sourceText.includes(`"${k}"`)) return false;
      for (const t of prefixes) if (k.startsWith(t)) return false;
      return !suffixes.has(k.split('.').pop() as string);
    });
    // Vitest in nguyên mảng khi đỏ, nên người đọc thấy luôn khóa nào cần xoá.
    expect(dead).toEqual([]);
  });
});
