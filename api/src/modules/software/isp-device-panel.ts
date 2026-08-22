import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { IspLineService } from './isp-line.service';

/**
 * Khu "Đường truyền ISP" trên trang thiết bị biên (AC 3.3: trang Draytek hiển thị các đường
 * ISP gắn với nó). Dùng đúng cơ chế khu mở rộng của story 2.5 — `devices` không biết ISP là gì.
 *
 * Hotline và số hợp đồng đưa lên ĐẦU: mở trang con Draytek lúc 2 giờ sáng là để gọi nhà mạng.
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

    const items = lines.flatMap((line) => [
      { label: line.code, value: line.provider, link: `/duong-truyen/${line.id}` },
      ...(line.hotline ? [{ label: 'Hotline', value: line.hotline }] : []),
      ...(line.contractNo ? [{ label: 'Số hợp đồng', value: line.contractNo }] : []),
      ...(line.wanIp ? [{ label: 'IP WAN', value: line.wanIp }] : []),
    ]);
    return { key: this.panelKey, title: 'Đường truyền ISP', items };
  }
}
