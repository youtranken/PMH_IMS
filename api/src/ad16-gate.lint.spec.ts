import { lint, printConfig, withProbe } from '../test/lint-probe';

/**
 * Bài kiểm cho CHÍNH CỔNG AD-16 — bản api của `web/src/lint-rules.test.ts`.
 *
 * ===== VÌ SAO NÓ RA ĐỜI MUỘN MỘT NGÀY =====
 *
 * Đợt A dựng luật `NO_VIETNAMESE_IDENT` cho cả ba cấu hình lint và mục 16.7 khai là đã cắm
 * xong. Bên web có bài canh cổng; bên api thì không — và rà soát chéo 21/09 tìm ra luật ấy
 * có một vùng mù đúng bằng hai chỗ:
 *
 *  1. **`api/test/**`** — luật chỉ nằm trong khối `files: ['src/**\/*.ts']`, nên cả tầng bài
 *     kiểm chạm DB không bao giờ được nó soi. Đúng tầng mà đợt B vừa mở thêm file mới.
 *  2. **Hai file `audit`** — khối ngoại lệ ở cuối `eslint.config.mjs` khai LẠI
 *     `'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX]` để nới một luật khác, và
 *     mảng đó không chứa AD-16. Khai lại một mảng mà thiếu một phần tử thì phần tử ấy biến
 *     mất — im lặng, vì cấu hình vẫn hợp lệ và repo vẫn sạch.
 *
 * Cả hai đều là hình dạng đã gặp hai lần trong repo này: **một luật khớp đúng số không
 * chuỗi**, và không có gì đỏ để ai biết. Lần đầu là AD-2 bên api (28/08, chín epic), lần hai
 * là `window.confirm` bên web (07/09).
 *
 * ===== HAI CÁCH HỎI, VÀ VÌ SAO CẦN CẢ HAI =====
 *
 * `lint()` chạy eslint thật trên một file probe — bằng chứng đanh nhất, nhưng chỉ đặt được
 * probe ở nơi mình tạo file được. Hai file `audit` là file THẬT, không gieo vi phạm vào
 * được, nên chỗ đó hỏi bằng `--print-config`: luật có CÓ MẶT trong cấu hình đã phân giải
 * cho file ấy không. Thiếu vế sau thì vùng mù thứ hai vẫn vô hình.
 */

/**
 * Định danh CÓ DẤU — lớp 1 của AD-16 chỉ khớp `[À-ỹ]`.
 *
 * Bản đầu của bài này dùng `soLuong` (không dấu) và cả năm ca đều đỏ, kể cả ca đối chứng.
 * Năm ca cùng đỏ là dấu hiệu probe sai chứ không phải cổng sai — nếu tin ngay con số đó thì
 * tôi đã đi "sửa" một cấu hình đang chạy đúng ở chỗ nó chạy đúng.
 */
const PROBE_SOURCE = 'export const soLượng = 1;\n';

/** Lấy mọi thông điệp `no-restricted-syntax` mà cấu hình đã phân giải cho một file. */
function restrictedMessages(relPath: string): string {
  return JSON.stringify(printConfig(relPath).rules['no-restricted-syntax'] ?? []);
}

describe('cổng AD-16 chạy thật', () => {
  it('trong `src/` → chặn (vế đối chứng: luật có hoạt động)', () => {
    withProbe('src/modules/devices/probe-ad16.ts', PROBE_SOURCE, () => {
      expect(lint('src/modules/devices/probe-ad16.ts')).toContain('AD-16');
    });
  });

  it('trong `api/test/` → CŨNG phải chặn, đó là vùng mù tìm ra 21/09', () => {
    withProbe('test/probe-ad16.spec.ts', PROBE_SOURCE, () => {
      expect(lint('test/probe-ad16.spec.ts')).toContain('AD-16');
    });
  });

  it('trong một `*.spec.ts` dưới `src/` → cũng chặn: bài kiểm cũng là mã', () => {
    withProbe('src/modules/devices/probe-ad16.spec.ts', PROBE_SOURCE, () => {
      expect(lint('src/modules/devices/probe-ad16.spec.ts')).toContain('AD-16');
    });
  });

  /*
   * Hai file mà khối ngoại lệ cuối cấu hình khai lại `no-restricted-syntax`.
   *
   * Hỏi cấu hình ĐÃ PHÂN GIẢI chứ không gieo vi phạm: đây là file sản phẩm thật, và một bài
   * kiểm sửa file thật rồi trả lại là một bài kiểm có ngày làm hỏng cây làm việc của ai đó.
   */
  it.each([
    'src/modules/audit/audit.interceptor.ts',
    'src/modules/audit/audit-writer.service.spec.ts',
  ])('%s — ngoại lệ khai lại mảng luật thì vẫn phải giữ AD-16', (file) => {
    expect(restrictedMessages(file)).toContain('AD-16');
  });
});
