import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DevicePanel, DevicePanelProvider, PanelViewer } from '../../common/device-panels';
import { DevicePanelRegistry } from '../../common/device-panels.registry';
import { AccessListService } from './access-list.service';
import { VaultService, type SecretKind } from './vault.service';

/**
 * Khu "Két sắt" trên trang chi tiết thiết bị (cơ chế panel của `DevicePanelRegistry`).
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
     * MA TRẬN QUYỀN HỎI Ở ĐÂY, KHÔNG PHẢI Ở CONTROLLER.
     *
     * `GET /devices/:id/panels` mở cho cả `member` — hợp lý, vì hồ sơ máy là việc hàng ngày.
     * Nhưng khu này bày NHÃN NGĂN và TÊN ĐĂNG NHẬP, đúng thứ mà `GET /vault/secrets` trả 403
     * cho một Member ngoài ma trận (`vault.controller.ts` gọi `assertCanSeeMetadata`), và đúng
     * "bản đồ công ty giữ bí mật ở đâu" mà `/vault/owners` khoá lại cho SA/Admin. Không hỏi ở
     * đây thì lặp `GET /devices` rồi gọi panel từng máy là lấy được cả kho, không để lại dấu vết.
     *
     * Trả `null` chứ không ném: người không có quyền thì khu này KHÔNG TỒN TẠI với họ, y như
     * một máy chưa cất secret nào — không phải một ô báo lỗi mách rằng "ở đây có thứ gì đó".
     */
    /*
     * HỎI "KHÔNG PHẢI SA/ADMIN", KHÔNG HỎI "CÓ PHẢI MEMBER".
     *
     * Hai câu nghe giống nhau nhưng hỏng ngược nhau. `role === 'member'` là mẫu MỞ MẶC ĐỊNH:
     * mọi vai KHÁC đi thẳng, không qua ma trận quyền. AD-9 nói ngược lại — quyền mặc định đóng.
     *
     * `UserRole` hiện chỉ có ba giá trị. Nhưng `PanelViewer.role` khai là
     * `string` CÓ CHỦ Ý (để `common` không phải phụ thuộc `auth`, AD-2), nên trình biên dịch
     * KHÔNG bắt được ngày thêm vai thứ tư — và vai đó lập tức đọc được nhãn ngăn két cùng tên
     * đăng nhập của mọi máy, im lặng, không ai biết.
     *
     * Đây là chỗ `access-list.service.ts` dùng mẫu `never` exhaustiveness để chống đúng lớp
     * lỗi này; ở đây không dùng được vì kiểu là `string`, nên phải đảo vị từ.
     */
    if (viewer.role !== 'sa' && viewer.role !== 'admin') {
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

// `Record<SecretKind, …>`: thêm loại ngăn mà quên nhãn ở đây là lỗi biên dịch, không phải "undefined".
const KIND_LABEL: Record<SecretKind, string> = {
  password: 'Mật khẩu',
  license_key: 'License key',
  totp: 'Mã 2 lớp',
  other: 'Khác',
};
