import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { ExpiryItem, ExpirySource } from './expiry-source';

/**
 * Sổ đăng ký nguồn hạn (AD-7).
 *
 * Nằm ở `common` chứ không nằm trong module `expiry`, vì cả hai bên đều cần chạm: engine
 * đọc sổ, còn `devices`/`software` ghi vào sổ. Để trong `expiry` thì mọi module muốn góp
 * nguồn đều phải import nội bộ của `expiry` — đúng bài học đã gặp với khu mở rộng ở 2.5.
 *
 * `@Global` để module chủ chỉ cần inject, không phải import chéo module của nhau.
 */
@Injectable()
export class ExpirySourceRegistry {
  private readonly logger = new Logger(ExpirySourceRegistry.name);
  private readonly sources: ExpirySource[] = [];

  register(source: ExpirySource): void {
    // Đăng ký hai lần (hot-reload, test dựng module nhiều lần) không được nhân đôi kết quả.
    if (this.sources.some((item) => item.sourceKind === source.sourceKind)) return;
    this.sources.push(source);
  }

  /** Danh sách nguồn để màn Expiry dựng bộ lọc theo loại. */
  list(): { kind: string; label: string; canRenew: boolean }[] {
    return this.sources.map((source) => ({
      kind: source.sourceKind,
      label: source.sourceLabel,
      canRenew: typeof source.renew === 'function',
    }));
  }

  find(kind: string): ExpirySource | undefined {
    return this.sources.find((source) => source.sourceKind === kind);
  }

  /**
   * Gom mọi mục hết hạn trong [from, to] từ TẤT CẢ nguồn đã đăng ký.
   *
   * Một nguồn hỏng chỉ mất phần của nguồn đó — màn cảnh báo hạn mà sập vì một module phụ
   * thì đúng thứ nó sinh ra để chống (hết hạn bất ngờ) lại xảy ra.
   */
  async collect(from: string, to: string, kinds?: string[]): Promise<ExpiryItem[]> {
    const wanted = kinds?.length
      ? this.sources.filter((source) => kinds.includes(source.sourceKind))
      : this.sources;

    const results = await Promise.all(
      wanted.map(async (source) => {
        try {
          return await source.findExpiring(from, to);
        } catch (error) {
          this.logger.error(
            `Nguồn hạn "${source.sourceKind}" lỗi: ${(error as Error).message}`,
          );
          return [] as ExpiryItem[];
        }
      }),
    );
    // Sắp theo ngày hết hạn: thứ gấp nhất nằm trên cùng, đó là lý do người ta mở màn này.
    return results.flat().sort((a, b) => a.end.localeCompare(b.end));
  }
}

@Global()
@Module({
  providers: [ExpirySourceRegistry],
  exports: [ExpirySourceRegistry],
})
export class ExpiryRegistryModule {}
