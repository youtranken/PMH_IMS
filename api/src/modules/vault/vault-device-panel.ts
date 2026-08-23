import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { VaultService } from './vault.service';

/**
 * Khu "Két sắt" trên trang chi tiết thiết bị (story 4.1, cơ chế 2.5).
 *
 * Chỉ hiện NHÃN và loại — không có giá trị, không có nút xem ở đây. Người dùng biết "máy này
 * có mật khẩu admin web đã cất" mà không lộ gì; muốn mở phải sang đường riêng của 4.2.
 */
@Injectable()
export class VaultDevicePanel implements DevicePanelProvider, OnModuleInit {
  readonly panelKey = 'vault';

  constructor(
    private readonly panels: DevicePanelRegistry,
    private readonly vault: VaultService,
  ) {}

  onModuleInit(): void {
    this.panels.register(this);
  }

  async buildFor(deviceId: string): Promise<DevicePanel | null> {
    const rows = await this.vault.listFor('device', deviceId);
    if (rows.length === 0) return null;
    return {
      key: this.panelKey,
      title: 'Két sắt',
      items: rows.map((row) => ({
        label: row.label,
        value: row.username ? `${KIND_LABEL[row.kind]} · ${row.username}` : KIND_LABEL[row.kind],
        tone: 'muted' as const,
      })),
    };
  }
}

const KIND_LABEL: Record<string, string> = {
  password: 'Mật khẩu',
  license_key: 'License key',
  other: 'Khác',
};
