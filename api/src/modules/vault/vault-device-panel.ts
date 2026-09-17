import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider, PanelViewer } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { AccessListService } from './access-list.service';
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
    private readonly access: AccessListService,
  ) {}

  onModuleInit(): void {
    this.panels.register(this);
  }

  async buildFor(deviceId: string, viewer: PanelViewer): Promise<DevicePanel | null> {
    /*
     * MA TRẬN QUYỀN HỎI Ở ĐÂY, KHÔNG PHẢI Ở CONTROLLER (bịt lỗ rò 17/09/2026).
     *
     * `GET /devices/:id/panels` mở cho cả `member` — hợp lý, vì hồ sơ máy là việc hàng ngày.
     * Nhưng khu này bày NHÃN NGĂN và TÊN ĐĂNG NHẬP, đúng thứ mà `GET /vault/secrets` trả 403
     * cho một Member ngoài ma trận (`vault.controller.ts` gọi `assertCanSeeMetadata`), và đúng
     * "bản đồ công ty giữ bí mật ở đâu" mà `/vault/owners` khoá lại cho SA/Admin. Trước bản
     * vá, lặp `GET /devices` rồi gọi panel từng máy là lấy được cả kho, không để lại dấu vết.
     *
     * Trả `null` chứ không ném: người không có quyền thì khu này KHÔNG TỒN TẠI với họ, y như
     * một máy chưa cất secret nào — không phải một ô báo lỗi mách rằng "ở đây có thứ gì đó".
     */
    if (viewer.role === 'member') {
      const tier = await this.access.tierFor(viewer.email, 'device', deviceId);
      if (tier === 'denied') return null;
    }

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
