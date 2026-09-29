import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../test/source-text';

/**
 * D-03 — BÁC BỎ VIỆC THÊM `CHECK`, CANH THỨ MÀ QUYẾT ĐỊNH CŨ DỰA VÀO.
 *
 * ===== VÌ SAO KHÔNG THÊM `CHECK` =====
 *
 * Sổ rà soát đề nghị: *"CHECK cho `approval.state`/`kind`/`subject_type`"*. Nhưng migration
 * `0023` đã quyết ngược lại, có ghi lý do:
 *
 *   "Từ vựng state KHÔNG nằm trong CHECK constraint: mỗi loại yêu cầu tự mang máy trạng thái
 *    của mình (`ApprovalFlowSpec`) và `approvals` chỉ biết cách chạy một máy bất kỳ.
 *    Break-glass và phiếu ISO có từ vựng khác hẳn nhau — nhét cả hai vào một CHECK
 *    cứng là bắt đầu con đường quen thuộc: một cột `status` với mười giá trị mà nửa số đó chỉ
 *    dùng cho một loại, và mỗi loại mới lại là một migration sửa CHECK."
 *
 * Thêm CHECK vào đây là phá một thiết kế có chủ ý.
 *
 * ===== NHƯNG QUYẾT ĐỊNH ẤY CÓ MỘT ĐIỀU KIỆN BÙ, VÀ KHÔNG AI CANH NÓ =====
 *
 * Chính `0023` viết tiếp:
 *
 *   "Đổi lại, tầng DB không bảo vệ được từ vựng — nên `ApprovalService.transition()` là đường
 *    DUY NHẤT đổi `state`, và nó tra sổ đăng ký trước khi ghi."
 *
 * Câu ấy là một LỜI HỨA, và không có bài này thì không gì giữ nó. Một `UPDATE approval SET
 * state = 'xong'` viết ở bất kỳ module nào sẽ chạy trót lọt — DB không cản (cố ý), và không
 * cổng nào hỏi. Lúc đó "từ vựng do sổ đăng ký quyết" trở thành một câu nói đúng về giấy tờ và
 * sai về thực tế.
 *
 * Nên việc đúng ở đây không phải thêm CHECK, mà là **dựng cái cổng cho điều kiện bù**.
 *
 * Hiện `state` chỉ được ghi ở hai chỗ, cả hai trong
 * `approvals.service.ts`, và cả hai lấy giá trị từ sổ đăng ký (`flow.initial`, `input.to`) —
 * không chỗ nào gõ chuỗi thẳng. Điều kiện bù đang ĐÚNG; bài này giữ cho nó còn đúng.
 */

const MODULES = join(__dirname, '..');
const OWNER = 'approvals';

function allSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return allSources(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Mọi chỗ gán `state:` trong một lượt ghi drizzle, kèm giá trị được gán. */
function stateAssignments(source: string): string[] {
  // Dừng ở `,` `}` hoặc hết dòng. Bản đầu chỉ dừng ở `,`, nên `{ state: flow.initial })` trả
  // về cả `})` ở đuôi — và chính vế đối chứng của bài này bắt được, trước khi lượt quét thật
  // kịp nói dối về những gì nó thấy.
  return [...stripComments(source).matchAll(/\bstate:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
}

describe('Chỉ `approvals` được ghi `approval.state`', () => {
  it('phép quét có mắt — nó thấy được thứ nó đang tìm (vế đối chứng)', () => {
    // Một lượt quét khớp đúng số không chuỗi trông y hệt một repo sạch. Repo này đã dựng nhầm
    // loại cổng đó bốn lần.
    expect(stateAssignments('await tx.update(approvalTable).set({ state: flow.initial })')).toEqual(
      ['flow.initial'],
    );
    expect(stateAssignments("// state: 'xong'")).toEqual([]);
  });

  it('không module nào ngoài `approvals` đụng tới `approvalTable`', () => {
    const offenders = allSources(MODULES).filter((file) => {
      const owner = file.slice(MODULES.length + 1).split(/[\\/]/)[0];
      if (owner === OWNER) return false;
      return stripComments(readFileSync(file, 'utf8')).includes('approvalTable');
    });
    expect(offenders).toEqual([]);
  });

  /**
   * VÀ GIÁ TRỊ GHI VÀO PHẢI ĐẾN TỪ SỔ ĐĂNG KÝ, KHÔNG PHẢI MỘT CHUỖI GÕ TAY.
   *
   * Đây mới là vế khó thấy. Ngay trong `approvals.service.ts`, một dòng `state: 'approved'`
   * cũng phá đúng lời hứa của `0023` — nó bỏ qua `ApprovalFlowSpec` và tự quyết từ vựng, mà
   * DB thì cố ý không cản.
   */
  it('mọi giá trị gán cho `state` đều là biến, không phải chuỗi viết thẳng', () => {
    const service = readFileSync(join(MODULES, OWNER, 'approvals.service.ts'), 'utf8');
    const literals = stateAssignments(service).filter((value) => /^['"`]/.test(value));
    expect(literals).toEqual([]);
  });
});
