import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { LicenseAssignmentService } from './license-assignment.service';
import { SoftwareService } from './software.service';
import { UI_PATHS } from '../../common/ui-paths';

/**
 * Khu "License đang cài" trên trang chi tiết thiết bị (story 3.2 + cơ chế 2.5).
 *
 * `software` TỰ ĐĂNG KÝ vào sổ của `devices`; module `devices` không hề biết license là gì
 * (AD-2). Đây là lần đầu cơ chế khu mở rộng của story 2.5 được dùng thật — Epic 4 (két sắt)
 * và Epic 5 (IP) cắm thêm y hệt, không phải sửa một dòng nào trong `devices`.
 */
@Injectable()
export class SoftwareDevicePanel implements DevicePanelProvider, OnModuleInit {
  readonly panelKey = 'software';

  constructor(
    private readonly panels: DevicePanelRegistry,
    private readonly assignments: LicenseAssignmentService,
    private readonly software: SoftwareService,
  ) {}

  onModuleInit(): void {
    this.panels.register(this);
  }

  async buildFor(deviceId: string): Promise<DevicePanel | null> {
    const rows = await this.assignments.listForDevice(deviceId);
    // Máy không có license nào thì KHÔNG hiện khu này — trang chi tiết đã dài rồi,
    // thêm một khối trống chỉ tổ làm loãng.
    if (rows.length === 0) return null;

    const items = await Promise.all(
      rows.map(async (row) => {
        const license = await this.software.findOne(row.softwareId);
        return {
          label: license.name,
          value: license.code,
          link: UI_PATHS.software(license.id),
        };
      }),
    );
    return { key: this.panelKey, title: 'License đang cài', items };
  }
}
