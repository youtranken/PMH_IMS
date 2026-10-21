import { Global, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { FeatureHolding, FeatureTick } from './features';

/**
 * Sổ "ai đang giữ việc của mảng nào" (Q-31). `auth` cần biết người phụ trách phiếu ISO trước khi
 * bỏ tick hay chuyển nhóm, nhưng module nền không được import module nghiệp vụ
 * (`base-must-not-import-biz`). Nên `iso-forms` ghi vào sổ lúc khởi động, `auth` chỉ đọc sổ.
 */
export interface FeatureHolderSource {
  /** Những mảng nguồn này trả lời. */
  readonly features: readonly FeatureTick[];
  /** Việc đang giữ của những người trong `userIds`. */
  holdings(userIds: readonly string[]): Promise<FeatureHolding[]>;
}

/**
 * Thiếu nguồn thì sổ trả rỗng và SA bỏ được tick của một phiếu đang có người phụ trách, mà không
 * có gì đỏ. Nên kiểm lúc BOOT: thiếu thì api không lên.
 */
const MUST_ANSWER: readonly FeatureTick[] = ['iso_0203', 'iso_0208'];

@Injectable()
export class FeatureHolderRegistry implements OnApplicationBootstrap {
  private readonly sources: FeatureHolderSource[] = [];

  onApplicationBootstrap(): void {
    const answered = new Set(this.sources.flatMap((source) => source.features));
    const missing = MUST_ANSWER.filter((feature) => !answered.has(feature));
    if (missing.length > 0) {
      throw new Error(
        `FeatureHolderRegistry: không ai báo người giữ việc của ${missing.join(', ')}. ` +
          'Kiểm IsoFormsApiService.onModuleInit còn chạy không.',
      );
    }
  }

  register(source: FeatureHolderSource): void {
    if (this.sources.includes(source)) return;
    this.sources.push(source);
  }

  async holdings(userIds: readonly string[]): Promise<FeatureHolding[]> {
    if (userIds.length === 0) return [];
    const all = await Promise.all(this.sources.map((source) => source.holdings(userIds)));
    return all.flat();
  }
}

@Global()
@Module({
  providers: [FeatureHolderRegistry],
  exports: [FeatureHolderRegistry],
})
export class FeatureHolderModule {}
