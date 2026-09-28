import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { redactMessage } from './log-redact';

/**
 * Một sự kiện của module KHÁC liên quan tới một thiết bị — dòng thời gian hợp nhất ở tab Lịch
 * sử của trang thiết bị (DEV-086): "máy này từng dùng key nào, IP nào".
 *
 * Trả dữ liệu có cấu trúc (nguồn · hành động · đối tượng), KHÔNG trả câu chữ: màn hình dựng
 * câu qua i18n, và bài kiểm/API khỏi phải so chuỗi tiếng Việt.
 */
export interface DeviceTimelineEntry {
  /** Khoá ổn định cho React — duy nhất trong phạm vi nguồn. */
  id: string;
  /** Module góp dòng này: `ipam`, `software`… — chip lọc của màn hình bám vào đây. */
  source: string;
  /** Hành động theo từ vựng riêng của nguồn, vd `ip-assigned`, `license-released`. */
  action: string;
  at: Date;
  actor: string;
  /** Tên đối tượng người ta nhận ra được: địa chỉ IP, mã hồ sơ phần mềm. */
  subject: string;
  /** Đường dẫn giao diện tới đối tượng, nếu có. */
  link: string | null;
}

export interface DeviceTimelineProvider {
  readonly source: string;
  /** Tối đa `limit` sự kiện mới nhất của máy này. */
  timelineFor(deviceId: string, limit: number): Promise<DeviceTimelineEntry[]>;
}

export interface DeviceTimeline {
  items: DeviceTimelineEntry[];
  /** Nguồn đọc lỗi — màn hình nói ra thay vì để người đọc tưởng máy chưa từng dùng gì. */
  failedSources: string[];
}

/**
 * Sổ đăng ký dòng thời gian của thiết bị — cùng khuôn `DevicePanelRegistry`: `devices` ĐỌC sổ,
 * module giữ tài sản GHI vào sổ lúc khởi động. `devices` gọi thẳng `ipam.api`/`software.api`
 * thì thành vòng phụ thuộc (hai module đó đã import `devices.api`).
 */
@Injectable()
export class DeviceTimelineRegistry {
  private readonly logger = new Logger(DeviceTimelineRegistry.name);
  private readonly providers: DeviceTimelineProvider[] = [];

  register(provider: DeviceTimelineProvider): void {
    if (this.providers.some((item) => item.source === provider.source)) return;
    this.providers.push(provider);
  }

  /** Mới nhất lên đầu, cắt ở `limit` sau khi gộp mọi nguồn. */
  async timelineFor(deviceId: string, limit: number): Promise<DeviceTimeline> {
    const failedSources: string[] = [];
    const lists = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          return await provider.timelineFor(deviceId, limit);
        } catch (error) {
          // Một nguồn hỏng không làm sập tab Lịch sử — hồ sơ của chính máy vẫn phải đọc được.
          this.logger.error(`Dòng thời gian "${provider.source}" lỗi: ${redactMessage(error)}`);
          failedSources.push(provider.source);
          return [];
        }
      }),
    );
    const items = lists
      .flat()
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, limit);
    return { items, failedSources };
  }
}

@Global()
@Module({
  providers: [DeviceTimelineRegistry],
  exports: [DeviceTimelineRegistry],
})
export class DeviceTimelineModule {}
