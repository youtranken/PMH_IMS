import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './test/source-text';

/**
 * AD-2 CÒN MỘT CỬA KHÔNG AI CANH: SQL THÔ.
 *
 * ===== VÌ SAO CẦN BÀI NÀY =====
 *
 * Một câu `LEFT JOIN users u ON u.email = a.actor` trong `audit-query.service.ts` là đọc
 * thẳng bảng của module khác, thứ AD-2 cấm tường minh — mà `users.api.ts` còn viết đúng câu
 * luật ("module khác inject class này, KHÔNG query bảng `users`").
 *
 * Câu như thế sống được lâu vì CẢ HAI cổng đang canh AD-2 đều nhìn nhầm chỗ:
 *
 *   · eslint `no-restricted-imports` khớp CHUỖI IMPORT. Ở đây không có import nào.
 *   · `dependency-cruiser` khớp ĐƯỜNG DẪN ĐÃ RESOLVE. Một câu SQL không resolve thành gì cả.
 *
 * Hai cổng, cùng một điểm mù, và điểm mù ấy có hình dạng đúng bằng "ranh giới module bị phá
 * bằng một công cụ khác công cụ mà cổng biết đọc". `ad2-boundary.spec.ts` canh vế import;
 * file này canh vế SQL.
 *
 * ===== ĐÂY KHÔNG PHẢI RỦI RO LÝ THUYẾT =====
 *
 * Câu JOIN kiểu ấy đã sinh HAI sự cố thật: `u.sub` không tồn tại nên endpoint 500 ở mọi lần
 * gọi, và `created_at` mơ hồ làm vỡ mỗi lượt lọc theo ngày. Cả hai đều là hệ quả trực tiếp của việc một module tự suy đoán về
 * lược đồ của module khác — đúng thứ AD-2 sinh ra để không bao giờ phải suy đoán.
 *
 * ===== CÁCH HỎI =====
 *
 * Chủ sở hữu bảng đọc từ chính `*.schema.ts` của mỗi module (AD-3: một bảng một chủ), không
 * phải từ một danh sách chép tay — danh sách chép tay sẽ lệch khỏi lược đồ ở lần thêm bảng
 * thứ nhất.
 *
 * Lột chú thích TRƯỚC khi quét: một bài kiểm đọc mã nguồn mà không lột chú thích có thể xanh
 * vì một dòng chú thích (xem `test/source-text.ts`). Ở đây chiều lỗi ngược lại — không
 * lột thì một cái tên bảng nằm trong chú thích thành vi phạm giả — nhưng bài học là một:
 * `indexOf` không phân biệt mã với lời bàn.
 */

const MODULES_DIR = join(__dirname, 'modules');

/**
 * Tên bảng đứng sau `FROM` / `JOIN` / `INTO` / `UPDATE`.
 *
 * Cố ý quét TRỌN file đã lột chú thích chứ không cố bóc riêng các khối ``sql`…` ``: một biểu
 * thức `${...}` lồng backtick sẽ cắt cụt khối, và khối bị cắt cụt thì bảng nằm sau chỗ cắt
 * biến mất khỏi tầm nhìn — tức là cổng lặng lẽ khớp ít đi. Quét rộng rồi lọc theo bảng CÓ CHỦ
 * an toàn hơn hẳn: `.from(natRuleTable)` của drizzle không khớp (không có khoảng trắng sau
 * `from`), còn một cái tên trùng với bảng thật thì đằng nào cũng đáng nhìn.
 */
export function tableRefsIn(source: string): string[] {
  const pattern = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi;
  const out = new Set<string>();
  for (const match of stripComments(source).matchAll(pattern)) {
    out.add(match[1].toLowerCase());
  }
  return [...out];
}

/** Mọi file `.ts` dưới một thư mục, đệ quy. */
function allSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return allSources(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** `tên bảng → module sở hữu`, đọc từ các `*.schema.ts` (AD-3). */
function tableOwners(): Map<string, string> {
  const owners = new Map<string, string>();
  for (const moduleName of readdirSync(MODULES_DIR)) {
    const dir = join(MODULES_DIR, moduleName);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.schema.ts')) continue;
      const source = readFileSync(join(dir, file), 'utf8');
      for (const match of source.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g)) {
        owners.set(match[1], moduleName);
      }
    }
  }
  return owners;
}

describe('AD-2 — SQL thô không được chạm bảng của module khác', () => {
  const owners = tableOwners();

  /**
   * MỘT CỔNG KHỚP ĐÚNG SỐ KHÔNG CHUỖI TRÔNG Y HỆT MỘT CỔNG KHÔNG CÓ GÌ ĐỂ BẮT.
   *
   * Repo này đã dựng nhầm loại cổng đó ba lần (AD-2 bản glob, `window.confirm` bên web, AD-16
   * bên api). Nên trước khi tin lượt quét ở dưới báo "sạch", phải chứng minh nó có mắt.
   */
  describe('bản thân phép quét — vế đối chứng', () => {
    it('đọc được bản đồ chủ sở hữu từ lược đồ, không phải một danh sách rỗng', () => {
      expect(owners.size).toBeGreaterThan(20);
      expect(owners.get('users')).toBe('users');
      expect(owners.get('nat_rule')).toBe('ipam');
      expect(owners.get('audit_log')).toBe('audit');
    });

    it.each([
      ['LEFT JOIN users u ON u.email = a.actor', 'users', 'đúng câu đã lọt chín epic'],
      ['SELECT * FROM device WHERE id = $1', 'device', 'JOIN ẩn dưới dạng FROM'],
      ['insert into ip_address (address) values ($1)', 'ip_address', 'chữ thường'],
      ['UPDATE  software  SET seat_total = 1', 'software', 'hai khoảng trắng'],
      ['SELECT 1 FROM ONLY device', 'device', 'ONLY của kế thừa bảng'],
      ['FROM\n        audit_log a', 'audit_log', 'xuống dòng giữa FROM và tên bảng'],
    ])('bắt được %p', (source, table) => {
      expect(tableRefsIn(source)).toContain(table);
    });

    it.each([
      ['const rows = await tx.select().from(natRuleTable);', 'drizzle không phải SQL thô'],
      ['// LEFT JOIN users u ON u.email = a.actor', 'chú thích một dòng'],
      ['/* SELECT * FROM users */', 'chú thích khối'],
    ])('KHÔNG bắt oan %p (%s)', (source) => {
      expect(tableRefsIn(source)).toEqual([]);
    });
  });

  it('không module nào đọc bảng của module khác bằng SQL thô', () => {
    const offences: string[] = [];
    for (const file of allSources(MODULES_DIR)) {
      const owningModule = file.slice(MODULES_DIR.length + 1).split(/[\\/]/)[0];
      for (const table of tableRefsIn(readFileSync(file, 'utf8'))) {
        const owner = owners.get(table);
        // Bảng không có chủ = `information_schema`, `pg_stat_activity`, bảng tạm… Không phải
        // việc của AD-2.
        if (owner === undefined || owner === owningModule) continue;
        offences.push(`${owningModule} đọc bảng \`${table}\` của ${owner} (${file})`);
      }
    }
    expect(offences).toEqual([]);
  });
});
