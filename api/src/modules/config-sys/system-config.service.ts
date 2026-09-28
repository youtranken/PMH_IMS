import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { CONFIG_KEYS, type ConfigName } from './system-config.keys';
import { parseConfigNumber } from './system-config.parse';
import { systemConfigTable } from './system-config.schema';

const CACHE_TTL_MS = 30_000;

/**
 * AD-11: đọc tham số vận hành từ bảng `system_config`. Code KHÔNG được viết hằng số
 * nghiệp vụ — mọi ngưỡng đi qua đây. Cache 30 giây để mỗi request đăng nhập không
 * bắn thêm query, nhưng vẫn đủ nhanh để Admin sửa là thấy tác dụng.
 */
@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async getNumber(name: ConfigName): Promise<number> {
    const spec = CONFIG_KEYS[name];
    const raw = await this.read(spec.key);
    /*
     * Phép ép kiểu nằm ở `parseConfigNumber` — hàm thuần, có test bảng dữ liệu.
     * Bản trước viết thẳng `Number(raw)` ở đây và để chuỗi RỖNG lọt thành 0: xem chú thích
     * đầu `system-config.parse.ts` cho hậu quả (cả công ty không đăng nhập được).
     */
    const parsed = parseConfigNumber(raw, spec.fallback as number);
    if (parsed.fellBack) {
      this.logger.warn(
        `Cấu hình ${spec.key} không phải số hợp lệ (${JSON.stringify(raw)}) — dùng mặc định ${spec.fallback}`,
      );
    }
    return parsed.value;
  }

  async getString(name: ConfigName): Promise<string> {
    const spec = CONFIG_KEYS[name];
    const raw = await this.read(spec.key);
    return typeof raw === 'string' ? raw : String(spec.fallback);
  }

  /** Đọc nhiều khóa một lần — luồng đăng nhập cần 4 tham số, không nên 4 query. */
  async getMany(names: ConfigName[]): Promise<Record<string, unknown>> {
    const keys = names.map((n) => CONFIG_KEYS[n].key);
    const rows = await this.db
      .select()
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, keys));
    const now = Date.now();
    const out: Record<string, unknown> = {};
    for (const name of names) {
      const spec = CONFIG_KEYS[name];
      const row = rows.find((r) => r.key === spec.key);
      const value = row ? row.value : spec.fallback;
      this.cache.set(spec.key, { value, at: now });
      out[name] = value;
    }
    return out;
  }

  /** Admin sửa tham số — ghi trong transaction của request (AD-5) rồi xoá cache. */
  async setWithin(tx: Tx, name: ConfigName, value: unknown, actor: string): Promise<void> {
    const spec = CONFIG_KEYS[name];
    await tx
      .update(systemConfigTable)
      .set({ value, updatedAt: new Date(), updatedBy: actor })
      .where(eq(systemConfigTable.key, spec.key));
    this.cache.delete(spec.key);
  }

  /**
   * Bỏ giá trị đã nhớ của một khoá — gọi SAU khi transaction ghi đã commit. Chỉ tác dụng trong
   * tiến trình này; tiến trình khác (worker) tự nạp lại sau tối đa `CACHE_TTL_MS`.
   */
  forget(key: string): void {
    this.cache.delete(key);
  }

  private async read(key: string): Promise<unknown> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const rows = await this.db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, key));
    const fallback = Object.values(CONFIG_KEYS).find((s) => s.key === key)?.fallback;
    const value = rows[0]?.value ?? fallback;
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }
}
