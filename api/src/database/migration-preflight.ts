import type { PoolClient } from 'pg';

/**
 * Kiểm dữ liệu TRƯỚC khi áp một migration mà dữ liệu cũ có thể làm hỏng, để người trực đọc được
 * phải dọn hàng nào thay vì một lỗi 23505 chỉ nêu tên chỉ mục.
 *
 * Chỉ dành cho file đã có mà không sửa được nữa (checksum, AD-10). Migration mới thì tự kiểm
 * trong SQL bằng khối `DO … RAISE` như `0041_device_port_ci.sql`.
 *
 * Trả câu lỗi khi dữ liệu chặn, `null` khi đi tiếp được.
 */
type Preflight = (client: PoolClient) => Promise<string | null>;

const PREFLIGHTS: Record<string, Preflight> = {
  /** Q-20: một máy giữ tối đa một IP đang cấp. Xem docs/RUNBOOK-4.3-dong-dot-1.md. */
  '0037_ip_one_per_device.sql': async (client) => {
    const dup = await client.query<{ code: string; ips: string }>(
      `SELECT d.code, string_agg(host(ip.address), ', ' ORDER BY ip.address) AS ips
         FROM ip_address ip
         JOIN device d ON d.id = ip.device_id
        WHERE ip.device_id IS NOT NULL AND ip.voided_at IS NULL AND ip.status = 'assigned'
        GROUP BY d.code
       HAVING count(*) > 1
        ORDER BY d.code`,
    );
    if ((dup.rowCount ?? 0) === 0) return null;
    const list = dup.rows.map((r) => `${r.code}: ${r.ips}`).join('; ');
    return (
      `${dup.rowCount} thiết bị đang giữ hơn một IP đang cấp (${list}). ` +
      'Mỗi máy chỉ giữ một IP (Q-20): thu hồi bớt IP thừa rồi khởi động lại — ' +
      'xem docs/RUNBOOK-4.3-dong-dot-1.md.'
    );
  },
};

export async function preflightMigration(
  client: PoolClient,
  file: string,
): Promise<string | null> {
  const check = PREFLIGHTS[file];
  return check ? check(client) : null;
}
