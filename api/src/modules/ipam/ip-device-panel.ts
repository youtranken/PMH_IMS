import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { IpAddressService } from './ip-address.service';
import { UI_PATHS } from '../../common/ui-paths';

/**
 * Khu "Địa chỉ IP" trên trang chi tiết thiết bị (story 5.4, AC: một trang đủ thông tin khi
 * xử lý sự cố).
 *
 * Đúng cơ chế của story 2.5: `ipam` tự cắm vào, `devices` không phải sửa một dòng nào.
 */
@Injectable()
export class IpDevicePanel implements DevicePanelProvider, OnModuleInit {
  readonly panelKey = 'ipam';

  constructor(
    private readonly panels: DevicePanelRegistry,
    private readonly addresses: IpAddressService,
  ) {}

  onModuleInit(): void {
    this.panels.register(this);
  }

  async buildFor(deviceId: string): Promise<DevicePanel | null> {
    const rows = await this.addresses.listForDevice(deviceId);
    if (rows.length === 0) return null;
    return {
      key: this.panelKey,
      title: 'Địa chỉ IP',
      items: rows.map((ip) => ({
        label: ip.address,
        value: ip.usedBy ?? STATUS_LABEL[ip.status],
        link: UI_PATHS.subnet(ip.subnetId),
        tone: TONE[ip.status],
      })),
    };
  }
}

const STATUS_LABEL: Record<string, string> = {
  free: 'Trống',
  assigned: 'Đang cấp',
  suspect_dead: 'Nghi chết',
  reclaimed: 'Đã thu hồi',
};

const TONE: Record<string, 'ok' | 'warn' | 'muted'> = {
  free: 'muted',
  assigned: 'ok',
  suspect_dead: 'warn',
  reclaimed: 'muted',
};
