import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { toNatHistory } from '@/features/ipam/nat-history-entries';
import { toIspHistory } from '@/features/isp/isp-history-entries';
import { toIpHistoryEntries } from '@/features/ipam/ip-history-entries';

/**
 * NĂM BẢN SAO CỦA MỘT HÀM, VÀ CHÚNG ĐÃ TRÔI KHỎI NHAU (F-09).
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `display()` + `describe()` của panel Lịch sử được CHÉP sáu lần: `device` · `ip` · `isp` ·
 * `nat` · `service-account` · `software`. Đếm 22/09: BA bản có nhánh
 *
 *     if (field.endsWith('Id')) return t('history.changedOnly', { field: label });
 *
 * và BA bản không (`ip`, `nat`, `service-account`).
 *
 * Nhánh ấy tồn tại vì một lý do rất cụ thể: giá trị của các trường `*Id` là UUID, và UUID
 * trên màn lịch sử không nói gì với ai. Bản có nhánh nói "Site: đã thay đổi"; bản không có
 * nhánh IN NGUYÊN `a3f1c8e2-…` → `7b9d4f10-…` ra màn hình.
 *
 * Nên cùng một thao tác — sửa site — cho ra hai màn hình khác hẳn nhau tuỳ người dùng đang
 * đứng ở tab nào. Không lỗi nào báo, không cổng nào đỏ: sáu bản đều "đúng" với chính nó.
 *
 * ===== VÌ SAO BÀI NÀY SO CHÉO GIỮA CÁC MÀN =====
 *
 * Kiểm từng bản một thì mỗi bản vẫn tự nhất quán, và đó chính là cách sáu bản trôi được tới
 * đây. Câu hỏi đúng là câu SO SÁNH: "cùng một hình dạng dữ liệu, sáu màn có nói cùng một
 * kiểu không?"
 *
 * `t` là `t` THẬT của app, không phải stub trả lại chính khoá — cùng lý do đã ghi ở
 * `nat-history-entries.test.ts`.
 *
 * ===== VÌ SAO FILE NÀY Ở `src/` CHỨ KHÔNG Ở `ui/` =====
 *
 * Bản đầu tôi đặt nó cạnh `ui/history-changes.ts`, và lint đỏ ngay: AD-15 cấm tầng nền
 * (`ui`/`lib`/`shell`) biết tới `features`. Luật đúng, và nó đúng cả với bài kiểm — một file
 * trong `ui/` import sáu feature là đã mở đường cho `ui` phụ thuộc ngược.
 *
 * Đây là bài SO CHÉO giữa các feature, nên chỗ của nó là tầng trung lập `src/`, cạnh
 * `lint-rules.test.ts` và `token-usage.test.ts` — hai bài cùng loại.
 */

const t = i18n.t;

/** Một lượt sửa `siteId` — hình dạng giống nhau ở mọi sổ lịch sử. */
const SITE_CHANGED = {
  siteId: { before: 'a3f1c8e2-0000-0000-0000-000000000001', after: '7b9d4f10-0000-0000-0000-000000000002' },
};

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-/i;

describe('Panel Lịch sử — sáu màn phải nói cùng một kiểu', () => {
  it.each([
    ['NAT', () => toNatHistory([{ id: 'h1', action: 'updated', actor: 'sa@pmh.com.vn', changes: SITE_CHANGED, createdAt: '2026-09-22T03:00:00.000Z' }] as never, t)],
    ['Đường truyền', () => toIspHistory([{ id: 'h1', action: 'updated', actor: 'sa@pmh.com.vn', changes: SITE_CHANGED, createdAt: '2026-09-22T03:00:00.000Z' }] as never, t)],
    ['Địa chỉ IP', () => toIpHistoryEntries([{ id: 'h1', action: 'ip.updated', actor: 'sa@pmh.com.vn', changes: SITE_CHANGED, fromStatus: null, toStatus: null, createdAt: '2026-09-22T03:00:00.000Z' }] as never, t)],
  ])('%s: sửa một trường `*Id` KHÔNG in UUID ra màn hình', (_name, build) => {
    const text = JSON.stringify(build());
    expect(text).not.toMatch(UUID_IN_TEXT);
  });

  it.each([
    ['NAT', () => toNatHistory([{ id: 'h1', action: 'updated', actor: 'sa@pmh.com.vn', changes: SITE_CHANGED, createdAt: '2026-09-22T03:00:00.000Z' }] as never, t)],
    ['Đường truyền', () => toIspHistory([{ id: 'h1', action: 'updated', actor: 'sa@pmh.com.vn', changes: SITE_CHANGED, createdAt: '2026-09-22T03:00:00.000Z' }] as never, t)],
  ])('%s: và nói RÕ là trường đó đã đổi, không im lặng bỏ qua', (_name, build) => {
    // Vế đối chứng cho bản vá: giấu hẳn dòng đi cũng làm ca trên xanh, nhưng đó là mất thông
    // tin — người đọc lịch sử cần biết "site đã đổi", chỉ không cần biết UUID mới là gì.
    // `history.changedOnly` = "đổi {{field}}".
    expect(JSON.stringify(build())).toContain('đổi');
  });
});
