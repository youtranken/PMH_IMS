import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { NatRuleService } from './nat-rule.service';

/**
 * Khu "Sổ NAT" trên trang chi tiết thiết bị (AC 5.3: "trang thiết bị Draytek hiển thị danh
 * sách rule của nó").
 *
 * `ipam` tự đăng ký vào sổ của `devices` — module `devices` không hề biết NAT là gì (AD-2).
 * Máy không có rule nào thì KHÔNG hiện khu này: trang chi tiết đã dài, thêm một khối trống
 * chỉ tổ làm loãng.
 */
@Injectable()
export class NatDevicePanel implements DevicePanelProvider, OnModuleInit {
  readonly panelKey = 'nat';

  constructor(
    private readonly panels: DevicePanelRegistry,
    private readonly nat: NatRuleService,
  ) {}

  onModuleInit(): void {
    this.panels.register(this);
  }

  async buildFor(deviceId: string): Promise<DevicePanel | null> {
    const rules = await this.nat.listForDevice(deviceId);
    if (rules.length === 0) return null;
    return {
      key: this.panelKey,
      title: 'Sổ NAT',
      items: rules.map((rule) => ({
        label: `${rule.protocol.toUpperCase()} ${rule.externalPorts}`,
        // Một dòng trả lời đủ ba câu của auditor: đi đâu, cho ai, vì sao.
        value: `→ ${rule.internalIp}:${rule.internalPort} · ${rule.usedBy} · ${rule.reason}`,
        tone: rule.enabled ? ('ok' as const) : ('muted' as const),
      })),
    };
  }
}
