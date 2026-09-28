import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { SystemConfigService } from '../config-sys/system-config.service';
import { NatRuleService, type NatRuleRecord } from './nat-rule.service';
import { sensitivePortsOf } from './nat-sensitive';

/** Cổng nhạy cảm rule này mở (xét cả cổng trong — RDP đổi cổng ngoài vẫn là RDP), hoặc undefined. */
function sensitiveHit(rule: NatRuleRecord, sensitive: number[]): number | undefined {
  return sensitive.find(
    (port) =>
      port === rule.internalPort || (port >= rule.externalFrom && port <= rule.externalTo),
  );
}

/** Một rule đọc thành một dòng: đi đâu, cho ai, vì sao — kèm cờ nhạy cảm nếu có. */
function describe(rule: NatRuleRecord, sensitive: number[]): string {
  const hit = sensitiveHit(rule, sensitive);
  const flag = hit === undefined ? '' : ` · Nhạy cảm (cổng ${hit})`;
  return `→ ${rule.internalIp}:${rule.internalPort} · ${rule.usedBy} · ${rule.reason}${flag}`;
}

/**
 * Khu "Sổ NAT" trên trang chi tiết thiết bị (AC 5.3: "trang thiết bị Draytek hiển thị danh
 * sách rule của nó").
 *
 * `ipam` tự đăng ký vào sổ của `devices` — module `devices` không hề biết NAT là gì (AD-2).
 * Máy không có rule nào thì KHÔNG hiện khu này: trang chi tiết đã dài, thêm một khối trống
 * chỉ tổ làm loãng. Mỗi dòng bấm sang sổ NAT đã lọc sẵn theo router này.
 */
@Injectable()
export class NatDevicePanel implements DevicePanelProvider, OnModuleInit {
  readonly panelKey = 'nat';

  constructor(
    private readonly panels: DevicePanelRegistry,
    private readonly nat: NatRuleService,
    private readonly config: SystemConfigService,
  ) {}

  onModuleInit(): void {
    this.panels.register(this);
  }

  async buildFor(deviceId: string): Promise<DevicePanel | null> {
    const rules = await this.nat.listForDevice(deviceId);
    if (rules.length === 0) return null;
    const sensitive = sensitivePortsOf(await this.config.getString('natSensitivePorts'));
    return {
      key: this.panelKey,
      title: 'Sổ NAT',
      items: rules.map((rule) => ({
        label: `${rule.protocol.toUpperCase()} ${rule.externalPorts}`,
        // Một dòng trả lời đủ ba câu của auditor: đi đâu, cho ai, vì sao.
        value: describe(rule, sensitive),
        link: UI_PATHS.natOf(deviceId),
        tone: rule.enabled ? ('ok' as const) : ('muted' as const),
      })),
    };
  }
}

/**
 * Khu "Được NAT từ ngoài vào" trên trang của MÁY ĐÍCH (camera, NAS, máy chủ).
 *
 * Thanh lý hay đổi một máy chủ mà không biết RDP 3389 ngoài Internet đang trỏ vào nó là rủi
 * ro thật. Máy đích suy từ hồ sơ IP (`internalDeviceId`), cùng nguồn với cột "Đích bên trong"
 * của sổ NAT — không thêm cột thứ hai trả lời cùng một câu.
 */
@Injectable()
export class NatTargetDevicePanel implements DevicePanelProvider, OnModuleInit {
  readonly panelKey = 'nat-target';

  constructor(
    private readonly panels: DevicePanelRegistry,
    private readonly nat: NatRuleService,
    private readonly config: SystemConfigService,
  ) {}

  onModuleInit(): void {
    this.panels.register(this);
  }

  async buildFor(deviceId: string): Promise<DevicePanel | null> {
    const rules = (await this.nat.list()).filter((rule) => rule.internalDeviceId === deviceId);
    if (rules.length === 0) return null;
    const sensitive = sensitivePortsOf(await this.config.getString('natSensitivePorts'));
    return {
      key: this.panelKey,
      title: 'Được NAT từ ngoài vào',
      items: rules.map((rule) => ({
        label: `${rule.deviceCode ?? '—'} · ${rule.protocol.toUpperCase()} ${rule.externalPorts}`,
        value: describe(rule, sensitive),
        link: UI_PATHS.natOf(rule.deviceId),
        tone: !rule.enabled
          ? ('muted' as const)
          : sensitiveHit(rule, sensitive) !== undefined
            ? ('warn' as const)
            : ('ok' as const),
      })),
    };
  }
}
