import { Injectable, OnModuleInit } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import type { DeviceReleaser } from '../../common/device-retirement.registry';
import { DeviceRetirementRegistry } from '../../common/device-retirement.registry';
import type { Tx } from '../../common/tx';
import { IspLineService } from './isp-line.service';
import { ispLineTable } from './software.schema';

/**
 * Đường truyền đang cắm vào thiết bị biên sắp thanh lý.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `isp_line.device_id` trỏ tới `device` (0016), nhưng `software` chỉ đăng ký người dọn cho
 * GHẾ LICENSE. Nên thanh lý con router: ghế license được trả, IP được thu, rule NAT được gỡ
 * — còn hồ sơ đường truyền vẫn trỏ nguyên vào một máy đã ra khỏi công ty, và không câu nào
 * trong lượt thanh lý nhắc tới nó.
 *
 * Hậu quả không phải lý thuyết, nó ĐÃ xảy ra và đã được vá ở phần ngọn: chú thích trong
 * `IspLineService.prepare` kể lại rằng "máy đã thanh lý mà vẫn còn đường truyền cắm vào là
 * chuyện CÓ THẬT với dữ liệu cũ", và hàng rào `assertUsable` từng nhốt người dùng lại, không
 * cho sửa chính cái liên kết hỏng đó. Bản vá hôm ấy nới hàng rào để đi tiếp được. Đây là vá
 * phần gốc: đừng tạo ra liên kết hỏng ngay từ đầu.
 *
 * ===== GỠ MÁY, KHÔNG ĐỤNG HỢP ĐỒNG =====
 *
 * Ranh giới giống hệt `LicenseDeviceRetirement`: thanh lý một MÁY chỉ gỡ máy đó ra khỏi
 * đường truyền. Hồ sơ đường truyền không suy suyển — hợp đồng với nhà cung cấp vẫn còn hiệu
 * lực, hoá đơn vẫn về hằng tháng, và ngày mai nó sẽ cắm vào con router mới. Xoá hoặc đổi
 * `status` của nó theo máy là biến một lượt thay thiết bị thành một lượt mất hồ sơ hợp đồng.
 *
 * Vẫn đi qua `recordWithin` như mọi thay đổi khác: `isp_line_history` là bảng chỉ-thêm
 * (AD-13), và "đường truyền này rời khỏi router nào, ngày nào, vì sao" là câu sẽ có người
 * hỏi lúc đối soát với nhà cung cấp.
 */
@Injectable()
export class IspDeviceRetirement implements DeviceReleaser, OnModuleInit {
  readonly name = 'isp-line';

  constructor(
    private readonly registry: DeviceRetirementRegistry,
    private readonly isp: IspLineService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async holdingsOf(tx: Tx, deviceId: string): Promise<string[]> {
    const rows = await this.linesWithin(tx, deviceId);
    return rows.map((row) => `đường truyền ${row.code} (${row.provider})`);
  }

  async releaseWithin(tx: Tx, actor: string, deviceId: string): Promise<void> {
    for (const row of await this.linesWithin(tx, deviceId)) {
      await tx
        .update(ispLineTable)
        .set({ deviceId: null, updatedAt: new Date() })
        .where(eq(ispLineTable.id, row.id));
      await this.isp.recordWithin(tx, actor, row.id, 'device-detached', {
        deviceId: { before: deviceId, after: null },
      });
    }
  }

  /**
   * Đọc thô, KHÔNG qua `listForDevice`.
   *
   * `listForDevice` chạy `decorate()`, mà hàm đó gọi `devices.getById` cho từng dòng để lấy
   * mã/tên máy. Ở đây thứ duy nhất cần là `code`/`provider` của chính đường truyền, còn máy
   * thì đang bị thanh lý — hỏi thêm một vòng chỉ để vứt đi. Quan trọng hơn: đường DỌN phải
   * đọc trong `tx` của lượt thanh lý, mà `listForDevice` gắn cứng vào pool.
   */
  private async linesWithin(
    tx: Pick<Database, 'select'>,
    deviceId: string,
  ): Promise<{ id: string; code: string; provider: string }[]> {
    return tx
      .select({
        id: ispLineTable.id,
        code: ispLineTable.code,
        provider: ispLineTable.provider,
      })
      .from(ispLineTable)
      .where(eq(ispLineTable.deviceId, deviceId))
      .orderBy(asc(ispLineTable.code));
  }
}
