import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DEVICE_PANEL_PROVIDERS,
  type DevicePanel,
  type DevicePanelProvider,
} from '../../common/device-panels';

/**
 * Gom các khu mở rộng của trang chi tiết thiết bị (story 2.5).
 *
 * `@Optional()`: Đợt 1 chưa module nào đăng ký, token không tồn tại và danh sách là rỗng —
 * trang vẫn mở bình thường. Epic 5 (IP), Epic 4 (két sắt), Epic 3 (license) chỉ cần thêm
 * provider của mình, KHÔNG sửa một dòng nào trong `devices`.
 */
@Injectable()
export class DevicePanelsService {
  private readonly logger = new Logger(DevicePanelsService.name);

  constructor(
    @Optional()
    @Inject(DEVICE_PANEL_PROVIDERS)
    private readonly providers: DevicePanelProvider[] = [],
  ) {}

  async listFor(deviceId: string): Promise<DevicePanel[]> {
    const results = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          return await provider.buildFor(deviceId);
        } catch (error) {
          // Một module phụ hỏng KHÔNG được làm sập cả trang chi tiết thiết bị:
          // hồ sơ, bảo hành, port map, giấy tờ vẫn phải xem được.
          this.logger.error(
            `Khu mở rộng "${provider.panelKey}" lỗi: ${(error as Error).message}`,
          );
          return null;
        }
      }),
    );
    return results.filter((panel): panel is DevicePanel => panel !== null);
  }
}
