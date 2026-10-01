import type { Pool, PoolClient } from 'pg';
import { noteLooksLikeSecret, textLooksLikeSecret } from '../common/note-secret';

/**
 * Quét dữ liệu ĐANG CÓ tìm ô chữ dạng rõ trông như mật khẩu (Q-19, SEC-21) — chỉ BÁO CÁO.
 *
 * Luật chặn mới chỉ giữ cửa cho lần ghi sau; hàng đã ghi trước đó không tự sạch. Script không
 * tự sửa: chỉ người biết hồ sơ mới phân biệt được mật khẩu thật với mã model trông giống, và mật
 * khẩu thật đã lộ thì việc phải làm là XOAY nó, không chỉ xoá chữ.
 *
 * Kết quả chỉ có bảng · mã hồ sơ · cột — KHÔNG BAO GIỜ có đoạn chữ: in ra là chép bí mật sang
 * terminal, scrollback, file log của người chạy.
 */

export interface SecretTextFinding {
  table: string;
  /** Mã/nhãn để SA tìm hồ sơ trên giao diện (mã thiết bị, CIDR, IP…); thiếu thì là id. */
  ref: string;
  id: string;
  /** Tên cột, hoặc đường dẫn trong cột JSON của bảng lịch sử (`changes.note.after`). */
  field: string;
}

interface ColumnScan {
  table: string;
  /** Biểu thức SQL cho nhãn hồ sơ — chỉ đọc cột của chính bảng, không JOIN. */
  ref: string;
  columns: string[];
  /** Ghi chú két đi theo luật két (chặt hơn); mọi ô khác theo luật ô chữ tự do. */
  rule: (text: string) => boolean;
}

const text = textLooksLikeSecret;

/** Mọi ô chữ tự do có `@NoSecretText` ở cửa ghi, cộng ghi chú két. */
export const COLUMN_SCANS: readonly ColumnScan[] = [
  { table: 'device', ref: 'code', columns: ['note'], rule: text },
  { table: 'device_port', ref: 'port_label', columns: ['note'], rule: text },
  { table: 'software', ref: 'code', columns: ['note'], rule: text },
  { table: 'license_assignment', ref: 'id::text', columns: ['note', 'over_seat_reason'], rule: text },
  { table: 'isp_line', ref: 'code', columns: ['note'], rule: text },
  { table: 'subnet', ref: 'cidr::text', columns: ['description', 'void_reason'], rule: text },
  { table: 'ip_address', ref: 'host(address)', columns: ['note', 'void_reason'], rule: text },
  {
    table: 'nat_rule',
    ref: "host(internal_ip) || ':' || internal_port",
    columns: ['reason', 'note', 'void_reason'],
    rule: text,
  },
  { table: 'service_account', ref: 'code', columns: ['note'], rule: text },
  { table: 'site', ref: 'code::text', columns: ['address'], rule: text },
  { table: 'cabinet', ref: 'code::text', columns: ['description'], rule: text },
  { table: 'device_type', ref: 'name::text', columns: ['description'], rule: text },
  { table: 'department', ref: 'name::text', columns: ['description'], rule: text },
  { table: 'service_port', ref: 'name::text', columns: ['description'], rule: text },
  { table: 'approval', ref: 'id::text', columns: ['reason', 'decision_note'], rule: text },
  { table: 'access_list', ref: 'member_email', columns: ['note'], rule: text },
  { table: 'secret', ref: 'label', columns: ['note'], rule: noteLooksLikeSecret },
];

/** Đi hết cây JSON, gọi `visit` cho mỗi chuỗi kèm đường dẫn. */
function walkStrings(value: unknown, path: string, visit: (path: string, s: string) => void): void {
  if (typeof value === 'string') visit(path, value);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkStrings(v, `${path}.${k}`, visit);
  }
}

async function scanColumns(client: PoolClient): Promise<SecretTextFinding[]> {
  const found: SecretTextFinding[] = [];
  for (const scan of COLUMN_SCANS) {
    const cols = scan.columns.join(', ');
    const notNull = scan.columns.map((c) => `${c} IS NOT NULL`).join(' OR ');
    const rows = await client.query<Record<string, string | null>>(
      `SELECT id::text AS id, (${scan.ref}) AS ref, ${cols} FROM ${scan.table} WHERE ${notNull} ORDER BY 2, 1`,
    );
    for (const row of rows.rows) {
      for (const column of scan.columns) {
        const value = row[column];
        if (value && scan.rule(value)) {
          found.push({ table: scan.table, ref: row.ref ?? row.id ?? '', id: row.id ?? '', field: column });
        }
      }
    }
  }
  return found;
}

/**
 * Bảng lịch sử (`*_history`) chỉ-thêm: không sửa được, nhưng vẫn phải biết — mật khẩu nằm ở
 * đó là đã lộ, phải xoay. Tìm bảng theo information_schema để bảng lịch sử thêm sau cũng được
 * quét mà không ai phải nhớ khai.
 */
async function scanHistory(client: PoolClient): Promise<SecretTextFinding[]> {
  const tables = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name LIKE '%\\_history'
        AND data_type = 'jsonb'
      ORDER BY table_name, column_name`,
  );
  const found: SecretTextFinding[] = [];
  for (const { table_name: table, column_name: column } of tables.rows) {
    const rows = await client.query<{ id: string; doc: unknown }>(
      `SELECT id::text AS id, ${column} AS doc FROM ${table} WHERE ${column} IS NOT NULL ORDER BY id`,
    );
    for (const row of rows.rows) {
      const fields = new Set<string>();
      walkStrings(row.doc, column, (path, s) => {
        if (textLooksLikeSecret(s)) fields.add(path);
      });
      for (const field of fields) found.push({ table, ref: row.id, id: row.id, field });
    }
  }
  return found;
}

/**
 * `audit_log.detail` cũng là chữ dạng rõ chỉ-thêm: lý do khoá / vô hiệu tài khoản, lý do xin
 * quyền… đi thẳng vào đây mà không qua bảng lịch sử nào. Nhãn là hành động + đối tượng để SA
 * tìm lại được dòng nhật ký trên màn Nhật ký.
 *
 * Đọc theo lô bằng con trỏ khoá (created_at, id): bảng này lớn nhất DB, nạp hết một lần là
 * dồn cả nhật ký nhiều năm vào RAM của script.
 */
const AUDIT_BATCH = 2000;

async function scanAudit(client: PoolClient, batch: number): Promise<SecretTextFinding[]> {
  const found: SecretTextFinding[] = [];
  let after: { at: string; id: string } | null = null;
  for (;;) {
    const page: { rows: { id: string; at: string; ref: string; doc: unknown }[] } =
      await client.query(
        `SELECT id::text AS id, created_at::text AS at,
                action || ' ' || coalesce(object_type, '') || ':' || coalesce(object_id, '') AS ref,
                detail AS doc
           FROM audit_log
          WHERE detail IS NOT NULL
            AND ($1::timestamptz IS NULL OR (created_at, id) > ($1::timestamptz, $2::uuid))
          ORDER BY created_at, id
          LIMIT ${batch}`,
        [after?.at ?? null, after?.id ?? null],
      );
    for (const row of page.rows) {
      const fields = new Set<string>();
      walkStrings(row.doc, 'detail', (path, s) => {
        if (textLooksLikeSecret(s)) fields.add(path);
      });
      for (const field of fields) found.push({ table: 'audit_log', ref: row.ref, id: row.id, field });
    }
    if (page.rows.length < batch) return found;
    const last = page.rows[page.rows.length - 1];
    after = { at: last.at, id: last.id };
  }
}

export interface ScanOptions {
  /** Quét thêm cột JSON của các bảng `*_history` và `audit_log.detail`. */
  history?: boolean;
  /** Cỡ lô khi đọc `audit_log`; chỉ bài kiểm đổi để đi qua nhiều lô với ít dòng. */
  auditBatch?: number;
}

/** Chạy trong transaction READ ONLY: script báo cáo không bao giờ được là đường ghi. */
export async function scanSecretText(pool: Pool, options: ScanOptions = {}): Promise<SecretTextFinding[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const found = await scanColumns(client);
    if (options.history) {
      found.push(...(await scanHistory(client)));
      found.push(...(await scanAudit(client, options.auditBatch ?? AUDIT_BATCH)));
    }
    await client.query('COMMIT');
    return found;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Dòng báo cáo cho người đọc — chỉ bảng · nhãn · cột · id, không có nội dung ô. */
export function formatFindings(found: readonly SecretTextFinding[]): string[] {
  if (found.length === 0) return ['Không thấy ô nào trông như mật khẩu.'];
  const lines = found.map((f) => `${f.table}\t${f.ref}\t${f.field}\t${f.id}`);
  return [`Bảng\tHồ sơ\tCột\tid`, ...lines, '', `Tổng: ${found.length} ô cần SA rà.`];
}
