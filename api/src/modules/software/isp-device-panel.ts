import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { IspLineService } from './isp-line.service';
import { UI_PATHS } from '../../common/ui-paths';

/**
 * Khu "Đường truyền ISP" trên trang thiết bị biên (AC 3.3: trang Draytek hiển thị các đường
 * ISP gắn với nó). Dùng cơ chế khu mở rộng (`common/device-panels`) — `devices` không biết ISP
 * là gì.
 *
 * Hotline và số hợp đồng nằm ngay trên dòng của đường: mở trang con Draytek lúc 2 giờ sáng là
 * để gọi nhà mạng.
 */
@Injectable()
export class IspDevicePanel implements DevicePanelProvider, OnModuleInit {
  readonly panelKey = 'isp';

  constructor(
    private readonly panels: DevicePanelRegistry,
    private readonly isp: IspLineService,
  ) {}

  onModuleInit(): void {
    this.panels.register(this);
  }

  async buildFor(deviceId: string): Promise<DevicePanel | null> {
    const lines = await this.isp.listForDevice(deviceId);
    // Máy không cắm đường nào thì không hiện khu này (trang chi tiết đã dài).
    if (lines.length === 0) return null;

    /* MỘT đường = MỘT dòng. Bản đồ quan hệ và hộp Thanh lý đếm/liệt kê theo dòng: trải một
       đường thành bốn dòng nhãn–giá trị thì màn nói "4 đường truyền" và "sẽ gỡ: Hotline…". */
    const items = lines.map((line) => ({
      label: line.code,
      value: [
        line.provider,
        line.hotline ? `Hotline ${line.hotline}` : null,
        line.contractNo ? `HĐ ${line.contractNo}` : null,
        line.wanIp ? `WAN ${line.wanIp}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      link: UI_PATHS.ispLine(line.id),
    }));
    return { key: this.panelKey, title: 'Đường truyền ISP', items };
  }
}
