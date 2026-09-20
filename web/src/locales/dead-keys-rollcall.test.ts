/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { quetNguon } from '@/test/quet-nguon';

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
const DUOC_PHEP_KHONG_DUNG: Record<string, string> = {
  /*
   * Câu ĐÚNG, chưa được đấu dây — không phải rác (rà soát 19/09, mục 6).
   *
   * `features/ipam/service-port-picker.tsx` khi lọc không ra đang rơi về `select.noOptions`
   * ("— Không có lựa chọn —"), trong khi câu dưới đây nói được phải làm gì tiếp. Nó chưa hiện
   * ra vì `ui/combobox.tsx` chưa có prop `empty`. Giữ lại thay vì xoá: xoá xong thì lượt đấu
   * dây sau lại phải nghĩ lại câu chữ.
   */
  'nat.serviceEmpty':
    'chưa đấu dây — cần prop `empty` cho `ui/combobox.tsx`, xem mục 6 của RA-SOAT-TOAN-DIEN-2026-09-19',
};

/**
 * Khóa mà một template RỘNG (`` t(`ns.${bien}`) ``) thật sự dựng ra.
 *
 * Khai tay vì bộ quét cố ý không cứu theo tiền tố phủ cả namespace — xem chú thích ở chỗ
 * dựng `tienTo`. Thêm nhánh mới cho `ipCheck.reason` hay `done` thì thêm dòng ở đây; quên
 * thì bài này đỏ, và đỏ đúng chỗ.
 */
const KHOA_DUNG_DONG = new Set<string>([
  // `features/ipam/nat-screen.tsx` — `` t(`nat.${ipCheck.reason}`) ``
  'nat.internalIpRequired',
  'nat.internalIpNotOfTarget',
  // `features/service-accounts/service-accounts-screen.tsx` — `` t(`serviceAccounts.${done}`) ``
  'serviceAccounts.disabled',
  'serviceAccounts.enabled',
]);

/*
 * DÙNG BẢN CHUNG `quetNguon` (19/09/2026) — luật bỏ qua `__lint-probe__*` nay sống ở MỘT chỗ.
 *
 * File này từng là bản DUY NHẤT được vá cho cuộc đua ENOENT ngày 18/09, và nó được lấy làm dẫn
 * chứng khi `test/quet-nguon.ts` ra đời ngày 19/09 — nhưng chính nó lại không được chuyển sang
 * bản chung. Docblock của `quet-nguon.ts` và mục EPIC-MAP cùng khai "ba nơi gọi" trong khi thật
 * ra chỉ có hai. Lượt rà soát 19/09 đếm ra. Bản vá chống-chép-bản-sao để lại đúng một bản sao,
 * ở đúng file nó viện dẫn.
 *
 * `vi.ts` lọc SAU khi quét chứ không nhét vào `quetNguon`: đó là luật riêng của bài này (không
 * đếm chính file khai khóa là "nơi dùng khóa"), không phải luật chung của phép quét cây.
 */
function moiFile(dir: string): string[] {
  return quetNguon(dir, /\.tsx?$/).filter((f) => !f.endsWith('vi.ts'));
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

  /*
   * Tiền tố của mọi khóa dựng động: `` `abc.def_${…}` `` → 'abc.def_'.
   *
   * ===== TIỀN TỐ PHỦ CẢ NAMESPACE BỊ TỪ CHỐI (T-03, sửa 20/09/2026) =====
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
   * dùng thì khai tay ở `KHOA_DUNG_DONG` — danh sách ngắn, đọc được, và khi thêm nhánh mới
   * cho `ipCheck.reason` thì phải khai, đúng như khi thêm một khóa thường.
   */
  const tienTo = new Set(
    [...nguon.matchAll(/[`]([A-Za-z0-9_.]*?)\$\{/g)]
      .map((m) => m[1])
      .filter((t) => t && !t.endsWith('.')),
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
      if (KHOA_DUNG_DONG.has(k)) return false;
      if (nguon.includes(`'${k}'`) || nguon.includes(`"${k}"`)) return false;
      for (const t of tienTo) if (k.startsWith(t)) return false;
      return !hauTo.has(k.split('.').pop() as string);
    });
    // Vitest in nguyên mảng khi đỏ, nên người đọc thấy luôn khóa nào cần xoá.
    expect(chet).toEqual([]);
  });
});
