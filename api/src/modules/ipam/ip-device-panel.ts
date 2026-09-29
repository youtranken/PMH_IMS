import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { IpAddressService } from './ip-address.service';
import { UI_PATHS } from '../../common/ui-paths';
import type { IpStatus } from './ip-lifecycle';

/**
 * Khu "Địa chỉ IP" trên trang chi tiết thiết bị (AC: một trang đủ thông tin khi xử lý sự cố).
 *
 * Dùng cơ chế khu mở rộng (`common/device-panels`): `ipam` tự cắm vào, `devices` không phải
 * sửa một dòng nào.
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
        // Mở dải ở ĐÚNG địa chỉ này (tô sáng dòng) — một /24 thì khỏi lật sáu trang tìm lại.
        link: UI_PATHS.subnetAt(ip.subnetId, ip.address),
        tone: TONE[ip.status],
      })),
    };
  }
}

const STATUS_LABEL: Record<IpStatus, string> = {
  free: 'Trống',
  assigned: 'Đang dùng',
};

const TONE: Record<IpStatus, 'ok' | 'warn' | 'muted'> = {
  free: 'muted',
  assigned: 'ok',
};
