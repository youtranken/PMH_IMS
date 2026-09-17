import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider, PanelViewer } from './device-panels';
import { redactMessage } from './log-redact';

/**
 * Sổ đăng ký khu mở rộng của trang chi tiết thiết bị (story 2.5).
 *
 * Nằm ở `common` chứ KHÔNG nằm trong module `devices`, vì đây là hạ tầng dùng chung giữa
 * hai bên: `devices` đọc sổ, còn `software`/`vault`/`ipam` ghi vào sổ. Để trong `devices`
 * thì mọi module muốn góp panel đều phải chạm vào nội bộ của `devices` — đúng thứ AD-2 cấm
 * (và dependency-cruiser đã bắt được ngay lần đầu thử).
 *
 * `@Global` để module chủ chỉ cần inject, không phải import chéo module của nhau.
 */
@Injectable()
export class DevicePanelRegistry {
  private readonly logger = new Logger(DevicePanelRegistry.name);
  private readonly providers: DevicePanelProvider[] = [];

  register(provider: DevicePanelProvider): void {
    // Đăng ký hai lần (hot-reload, test dựng module nhiều lần) không được nhân đôi panel.
    if (this.providers.some((item) => item.panelKey === provider.panelKey)) return;
    this.providers.push(provider);
  }

  async listFor(deviceId: string, viewer: PanelViewer): Promise<DevicePanel[]> {
    const results = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          return await provider.buildFor(deviceId, viewer);
        } catch (error) {
          // Một module phụ hỏng KHÔNG được làm sập cả trang chi tiết thiết bị: hồ sơ,
          // bảo hành, port map, giấy tờ vẫn phải xem được — đó là màn tra cứu lúc có sự cố.
          this.logger.error(
            `Khu mở rộng "${provider.panelKey}" lỗi: ${redactMessage(error)}`,
          );
          return null;
        }
      }),
    );
    return results.filter((panel): panel is DevicePanel => panel !== null);
  }
}

@Global()
@Module({
  providers: [DevicePanelRegistry],
  exports: [DevicePanelRegistry],
})
export class DevicePanelsModule {}
