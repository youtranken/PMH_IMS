import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * CỬA CANH RÁC — bộ E2E không được để lại hàng nào mà chính nó không dọn nổi.
 *
 * ===== VÌ SAO CÓ FILE NÀY =====
 *
 * `api/scripts/reset-e2e.mjs` dọn theo QUY ƯỚC ĐẶT TÊN: `subnet.name ILIKE '%E2E%'`,
 * `software.code ILIKE '%E2E%'`, `device.code ILIKE '%E2E%'`. Một bài kiểm mới quên chữ "E2E"
 * trong tên thì hàng nó tạo ra KHÔNG BAO GIỜ bị dọn — và không có gì báo.
 *
 * Đã trả giá đúng một lần, 10/09/2026: hai spec mới đặt tên `LAN cua con lai …` và
 * `SSL-DARK-…`. Sau vài lượt chạy, 27 dải và 11 hồ sơ phần mềm tồn đọng, rồi làm đỏ TÁM bài ở
 * lượt E2E đầy đủ — `dashboard`, `expiry-digest` ×2, `ip-lifecycle`, `ipam`, `ipam.mobile` và
 * hai bài của chính spec mới. Tám bài đỏ đó trông y hệt một hồi quy của API: chúng đỏ ở những
 * khẳng định nghiệp vụ bình thường ("`17% · 1/6 · còn 5` phải hiện"), ở những file chẳng liên
 * quan gì tới thay đổi vừa làm. Mất một lượt chạy 33 phút và suýt nữa thì kết luận sai.
 *
 * Quy ước đặt tên là thứ dễ quên nhất trên đời, nên nó phải có cưỡng chế chứ không phải một
 * dòng trong tài liệu. Đây là cưỡng chế đó.
 *
 * ===== CHỈ ĐẾM HÀNG DO CHÍNH LƯỢT NÀY TẠO RA =====
 *
 * Mốc thời gian được `globalSetup` ghi lại. Không có nó thì cửa này đếm cả dữ liệu người dùng
 * gõ tay từ trước (`TT2`, phần mềm `1`/`2` trong DB dev) và đỏ mãi mãi vì một lý do sai — đúng
 * loại cổng mà người ta sẽ tắt đi sau hai ngày.
 */
export const RUN_START_FILE = fileURLToPath(new URL('.e2e-run-start', import.meta.url));

const COMPOSE =
  'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml exec -T postgres';

/** Bảng nào dọn theo cột nào — khớp NGUYÊN VĂN `api/scripts/reset-e2e.mjs`. */
const WATCHED: { table: string; column: string }[] = [
  { table: 'subnet', column: 'name' },
  { table: 'software', column: 'code' },
  { table: 'device', column: 'code' },
];

export function markRunStart(): void {
  writeFileSync(RUN_START_FILE, new Date().toISOString(), 'utf8');
}

/**
 * Trả về mô tả những hàng bị bỏ lại, hoặc chuỗi rỗng nếu sạch.
 *
 * KHÔNG ném ở đây: nơi gọi quyết định làm gì. Bản thân việc truy vấn hỏng (docker chưa lên,
 * psql trượt) cũng không được làm cả lượt chạy đỏ — cửa này canh RÁC, nó không phải là một
 * bài kiểm, và một lượt E2E xanh không đáng bị lật vì `docker exec` chớp một cái.
 */
export function findLeakedRows(): string {
  if (!existsSync(RUN_START_FILE)) return '';
  const since = readFileSync(RUN_START_FILE, 'utf8').trim();
  if (!since) return '';

  const parts: string[] = [];
  for (const { table, column } of WATCHED) {
    let out: string;
    try {
      out = execSync(
        `${COMPOSE} psql -U ims -d ims -tAc ` +
          `"SELECT ${column} FROM ${table} WHERE created_at > '${since}'::timestamptz ` +
          `AND ${column} NOT ILIKE '%E2E%' ORDER BY created_at LIMIT 10"`,
        { cwd: '..', stdio: 'pipe' },
      ).toString();
    } catch {
      return '';
    }
    const rows = out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (rows.length > 0) parts.push(`  ${table}.${column}: ${rows.join(', ')}`);
  }
  return parts.join('\n');
}

export function clearRunStart(): void {
  rmSync(RUN_START_FILE, { force: true });
}
