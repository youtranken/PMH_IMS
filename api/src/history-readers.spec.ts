import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HISTORY_PAGE_LIMIT } from './common/history';

/**
 * MỌI PANEL "LỊCH SỬ" PHẢI CÓ TRẦN, VÀ PHẢI LÀ CÙNG MỘT TRẦN.
 *
 * ===== VÌ SAO LÀ MỘT BÀI KIỂM ĐỌC MÃ NGUỒN =====
 *
 * Đây là loại luật mà không bài kiểm hành vi nào bắt được: một bộ đọc thiếu `.limit()` vẫn
 * trả về đúng dữ liệu, vẫn xanh mọi bài E2E, và chỉ tệ dần theo tuổi của hệ thống. Bảng
 * `*_history` là CHỈ-THÊM (AD-13) nên chúng chỉ có thể dài ra — một phiếu duyệt bị nhắc lại
 * nhiều lần, hay một rule NAT sửa vài năm, sẽ kéo cả nghìn dòng về trình duyệt cho một cái
 * panel không ai cuộn hết. Càng dùng lâu càng chậm, đúng lúc lịch sử đáng giá nhất.
 *
 * Khi chưa có cổng này, **3 trong 9** bộ đọc không có trần nào (`approvals`, `nat-rule`,
 * `service-account`), và số còn lại chia hai phe 100/200 không vì lý do gì. Trông như
 * "trùng lặp AD-15" — nhưng đọc kỹ thì thứ trôi khỏi nhau không phải câu `where` (mỗi bảng một cột khóa ngoại, có bảng ghép hai cột — gói vào
 * một hàm generic sẽ khó đọc hơn chính câu nó thay thế) mà là CON SỐ. Nên cái cần gom là con
 * số, và cái cần dựng là cổng này.
 *
 * Cùng khuôn với `ad2-gate.lint.spec.ts`: luật kiến trúc nào không có cổng thì luật đó chết
 * âm thầm.
 */

const MODULES = join(__dirname, 'modules');

interface Reader {
  where: string;
  order: 'asc' | 'desc';
  limit: string | null;
}

/** Quét mọi service, tìm câu đọc bảng `*_history` sắp theo `createdAt`. */
function readers(): Reader[] {
  const found: Reader[] = [];
  for (const dir of readdirSync(MODULES, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(MODULES, dir.name))) {
      if (!file.endsWith('.service.ts')) continue;
      const src = readFileSync(join(MODULES, dir.name, file), 'utf8');
      const re = /\.orderBy\((asc|desc)\((\w*[Hh]istory\w*)\.createdAt\)\)([\s\S]{0,80})/g;
      for (let m = re.exec(src); m !== null; m = re.exec(src)) {
        const limit = /\.limit\(([^)]*)\)/.exec(m[3]);
        found.push({
          where: `${dir.name}/${file}:${src.slice(0, m.index).split('\n').length}`,
          order: m[1] as 'asc' | 'desc',
          limit: limit ? limit[1].trim() : null,
        });
      }
    }
  }
  return found;
}

describe('Bộ đọc lịch sử — cùng thứ tự, cùng trần', () => {
  const all = readers();

  /** Cổng tự bảo vệ: regex hỏng thì mọi bài dưới xanh một cách vô nghĩa. */
  it('quét được ít nhất 9 bộ đọc — regex còn khớp', () => {
    expect(all.length).toBeGreaterThanOrEqual(9);
  });

  /**
   * MỚI NHẤT TRÊN ĐẦU, ở mọi màn. `ip-address.history()` từng là bản lệch duy nhất người dùng
   * NHÌN THẤY được (`asc`), nên chuyển qua lại giữa hai màn là đọc sai thứ tự mà không nhận ra
   * — dòng đầu bảng ở màn này là "lâu rồi", ở màn kia là "vừa xong". Vá ở đợt E1.
   */
  it('không bộ đọc nào dùng `asc`', () => {
    expect(all.filter((r) => r.order === 'asc').map((r) => r.where)).toEqual([]);
  });

  it('không bộ đọc nào thiếu trần', () => {
    expect(all.filter((r) => r.limit === null).map((r) => r.where)).toEqual([]);
  });

  /**
   * Số VIẾT CỨNG là cách con số trôi khỏi nhau lần nữa. Chỉ chấp nhận hằng số dùng chung,
   * hoặc một tham số do nơi gọi truyền (`recentRenewals(limit = 50)` của dashboard — nó không
   * phải panel lịch sử của MỘT hồ sơ nên có trần riêng là đúng).
   */
  it('trần phải là `HISTORY_PAGE_LIMIT`, không phải số gõ tay', () => {
    const hardcoded = all.filter((r) => r.limit !== null && /^\d+$/.test(r.limit));
    expect(hardcoded.map((r) => `${r.where} → limit(${r.limit})`)).toEqual([]);
  });

  it('hằng số có giá trị hợp lý — đủ lớn để đọc, đủ nhỏ để không thành vấn đề', () => {
    expect(HISTORY_PAGE_LIMIT).toBeGreaterThanOrEqual(100);
    expect(HISTORY_PAGE_LIMIT).toBeLessThanOrEqual(1000);
  });
});
