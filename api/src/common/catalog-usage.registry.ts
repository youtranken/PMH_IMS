import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { count, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../database/database.module';
import { redactMessage } from './log-redact';

/**
 * Sổ đăng ký "mục danh mục này đang được bao nhiêu hồ sơ dùng" (Q-15, màn Danh mục).
 *
 * `catalog` là tầng nền: `devices`, `software`, `ipam`, `service-accounts` đều import
 * `catalog.api`. Để `catalog` tự đếm bảng của họ là vừa đọc bảng module khác (AD-3) vừa tạo
 * vòng phụ thuộc (`no-circular`). Nên đảo chiều như `DevicePanelRegistry`: module chủ dữ liệu
 * tự ghi hàm đếm vào sổ lúc khởi động, `catalog` chỉ đọc sổ.
 *
 * Con số này chỉ để NGƯỜI ĐỌC biết trước — hàng rào xóa thật vẫn là khóa ngoại
 * ON DELETE RESTRICT. Vì thế sổ fail-soft: một module đếm hỏng chỉ mất phần của nó.
 */
export interface CatalogUsageCounter {
  /** Loại danh mục được đếm: 'site' | 'cabinet' | 'device_type' | 'vendor' | 'department'… */
  readonly entity: string;
  /** Thứ đang dùng mục đó: 'device' | 'software' | 'isp_line' | 'subnet' | … — web dịch ra chữ. */
  readonly kind: string;
  /**
   * Số hồ sơ trỏ tới từng mục. `name` đi kèm vì có loại được lưu bằng CHỮ chứ không bằng id
   * (bộ phận ghi vào cột `department` dạng text). Mục không có trong Map = 0.
   */
  countFor(refs: CatalogUsageRef[]): Promise<Map<string, number>>;
}

export interface CatalogUsageRef {
  id: string;
  name: string;
}

export interface CatalogUsage {
  kind: string;
  count: number;
}

@Injectable()
export class CatalogUsageRegistry {
  private readonly logger = new Logger(CatalogUsageRegistry.name);
  private readonly counters: CatalogUsageCounter[] = [];

  register(counter: CatalogUsageCounter): void {
    // Hot-reload hay test dựng module nhiều lần không được nhân đôi con số.
    if (this.counters.some((c) => c.entity === counter.entity && c.kind === counter.kind)) return;
    this.counters.push(counter);
  }

  /** Mỗi id một danh sách (có thể rỗng); chỉ giữ số > 0, theo thứ tự đăng ký. */
  async usageOf(entity: string, refs: CatalogUsageRef[]): Promise<Map<string, CatalogUsage[]>> {
    const out = new Map<string, CatalogUsage[]>(refs.map((ref) => [ref.id, []]));
    if (refs.length === 0) return out;
    const wanted = this.counters.filter((c) => c.entity === entity);
    const results = await Promise.all(
      wanted.map(async (counter) => {
        try {
          return await counter.countFor(refs);
        } catch (error) {
          this.logger.error(
            `Đếm "${counter.entity}/${counter.kind}" lỗi: ${redactMessage(error)}`,
          );
          return new Map<string, number>();
        }
      }),
    );
    wanted.forEach((counter, index) => {
      for (const [id, count] of results[index]) {
        if (count > 0) out.get(id)?.push({ kind: counter.kind, count });
      }
    });
    return out;
  }
}

/** Đếm theo cột khóa ngoại trỏ tới mục danh mục (`site_id`, `vendor_id`…). */
export async function countByRef(
  db: Database,
  table: PgTable,
  column: PgColumn,
  refs: CatalogUsageRef[],
): Promise<Map<string, number>> {
  const rows = await db
    .select({ key: sql<string>`${column}`, value: count() })
    .from(table)
    .where(inArray(column, refs.map((ref) => ref.id)))
    .groupBy(column);
  return new Map(rows.map((row) => [row.key, Number(row.value)]));
}

/**
 * Đếm theo cột CHỮ lưu tên mục (bộ phận). So không phân biệt hoa thường và bỏ khoảng trắng
 * hai đầu — ô nhập tự do của hồ sơ cũ ghi "kế toán " vẫn là bộ phận Kế toán. Hạ chữ thường
 * làm ở CẢ HAI phía trong Postgres: `toLowerCase` của JS và `lower()` của DB có thể lệch nhau
 * ở chữ có dấu tùy locale của DB, và lệch thì con số âm thầm ra 0.
 */
export async function countByName(
  db: Database,
  table: PgTable,
  column: PgColumn,
  refs: CatalogUsageRef[],
): Promise<Map<string, number>> {
  const ids = refs.map((ref) => ref.id);
  const names = refs.map((ref) => ref.name);
  const result = await db.execute<{ id: string; value: string }>(sql`
    SELECT r.id, count(t.*) AS value
      FROM unnest(${sql.param(ids)}::uuid[], ${sql.param(names)}::text[]) AS r(id, name)
      JOIN ${table} t ON lower(btrim(t.${sql.identifier(column.name)})) = lower(btrim(r.name))
     GROUP BY r.id`);
  return new Map(result.rows.map((row) => [row.id, Number(row.value)]));
}

@Global()
@Module({ providers: [CatalogUsageRegistry], exports: [CatalogUsageRegistry] })
export class CatalogUsageModule {}
