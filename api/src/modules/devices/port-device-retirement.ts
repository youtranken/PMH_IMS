import { Injectable, OnModuleInit } from '@nestjs/common';
import { eq, asc, sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import type { DeviceReleaser } from '../../common/device-retirement.registry';
import { DeviceRetirementRegistry } from '../../common/device-retirement.registry';
import type { Tx } from '../../common/tx';
import { devicePortTable, deviceTable } from './devices.schema';
import { DevicesService } from './devices.service';

/**
 * Cổng đấu chéo TRÊN MÁY KHÁC đang trỏ vào thiết bị sắp thanh lý.
 *
 * ===== VÌ SAO ĐÂY LÀ MỘT CHỦ NỢ THẬT, DÙ CÙNG MỘT MODULE =====
 *
 * `device_port` thuộc chính module `devices`, nên thoạt nhìn `setStatus` cứ tự dọn là xong,
 * không cần đi vòng qua sổ đăng ký. Nhưng đi qua sổ mới đúng, vì hai lý do:
 *
 *   1. Thông điệp CHẶN phải gom từ một chỗ. Người trực cần đọc một danh sách duy nhất "máy
 *      này còn giữ: địa chỉ IP …, ghế license …, cổng đấu chéo …", không phải hai câu do hai
 *      đường sinh ra với hai cách diễn đạt khác nhau.
 *   2. Thứ tự dọn và ranh giới transaction đã được sổ định nghĩa sẵn (`releaseAllWithin`).
 *      Viết tay lần thứ hai là cơ hội để quên một trong hai.
 *
 * ===== HAI CHIỀU CỦA MỘT SỢI DÂY, VÀ CHỈ MỘT CHIỀU ĐƯỢC ĐỘNG =====
 *
 * `0021_device_port.sql` ghi rõ: một sợi dây chỉ tạo MỘT bản ghi, không có bản đối xứng. Nên
 * khi máy X bị thanh lý có hai loại bản ghi liên quan, và chúng KHÁC NHAU:
 *
 *   · cổng NẰM TRÊN X (`device_port.device_id = X`) — đó là hồ sơ của chính X. Giữ nguyên.
 *     `DevicePortsService.remove` đã giải thích: sơ đồ đấu nối của một máy đã thanh lý là
 *     bằng chứng "hồi đó nó cắm vào đâu", xóa đi là làm mất đúng thứ cần lúc truy vết.
 *
 *   · cổng trên máy KHÁC trỏ vào X (`connected_device_id = X`) — đó là hồ sơ của máy khác,
 *     một máy vẫn đang chạy. Từ lúc X ra khỏi công ty, ô "đấu tới" của nó trỏ vào một hồ sơ
 *     đã đóng. Đây mới là thứ phải trả lại.
 *
 * ===== TRẢ LẠI ≠ XÓA TRẮNG =====
 *
 * Gỡ liên kết nhưng GIỮ CHỮ: `connected_device_id` về null, còn `connected_label` được điền
 * mã máy cũ nếu ô đó đang trống. Người mở port map của con switch sáu tháng sau vẫn đọc được
 * "cổng 24 → SW-CU-01 (đã thanh lý)" thay vì một ô trắng không giải thích được. `connected_label`
 * sinh ra đúng cho tình huống "đầu kia là thứ không có hồ sơ trong hệ thống".
 *
 * Không đè khi ô đã có chữ: người trực có thể đã ghi tay thứ gì đó ở đó, và ghi chú của họ
 * quan trọng hơn suy đoán của lượt dọn tự động.
 */
@Injectable()
export class PortDeviceRetirement implements DeviceReleaser, OnModuleInit {
  readonly name = 'device-ports';

  constructor(
    private readonly registry: DeviceRetirementRegistry,
    private readonly devices: DevicesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async holdingsOf(tx: Tx, deviceId: string): Promise<string[]> {
    const rows = await this.incomingWithin(tx, deviceId);
    return rows.map(
      (row) => `cổng ${row.portLabel} trên ${row.ownerCode} đang đấu vào máy này`,
    );
  }

  async releaseWithin(tx: Tx, actor: string, deviceId: string): Promise<void> {
    const rows = await this.incomingWithin(tx, deviceId);
    if (rows.length === 0) return;

    // Mã của máy đang bị thanh lý — đọc MỘT lần, dùng cho mọi ô `connected_label` phải điền.
    const retired = await this.devices.requireRowWithin(tx, deviceId);
    const label = `${retired.code} (đã thanh lý)`;

    for (const row of rows) {
      await tx
        .update(devicePortTable)
        .set({
          connectedDeviceId: null,
          // `COALESCE` ở tầng SQL chứ không `?? ` ở tầng JS: giá trị cũ đọc được từ `rows`
          // là ảnh chụp, còn câu này phải quyết định trên giá trị THẬT lúc ghi.
          connectedLabel: sql`coalesce(${devicePortTable.connectedLabel}, ${label})`,
          updatedAt: new Date(),
        })
        .where(eq(devicePortTable.id, row.id));

      /*
       * Ghi vào lịch sử của MÁY GIỮ BẢN GHI (máy còn sống), không phải máy bị thanh lý.
       * Cùng quy ước với mọi thay đổi cổng khác — xem chú thích đầu `DevicePortsService`.
       * Người mở tab Lịch sử của con switch phải thấy "cổng 24 bị gỡ liên kết vì máy đầu kia
       * đã thanh lý", chứ không phải thấy cổng tự nhiên trống ra.
       */
      await this.devices.recordWithin(tx, actor, row.ownerId, 'port-unlinked', {
        portLabel: { before: row.portLabel, after: row.portLabel },
        connectedDevice: { before: retired.code, after: null },
      });
    }
  }

  /** Cổng của thiết bị KHÁC đang cắm vào thiết bị này. Một câu, hai lối vào (chặn và dọn). */
  private async incomingWithin(
    tx: Pick<Database, 'select'>,
    deviceId: string,
  ): Promise<{ id: string; portLabel: string; ownerId: string; ownerCode: string }[]> {
    const rows = await tx
      .select({ port: devicePortTable, owner: deviceTable })
      .from(devicePortTable)
      .innerJoin(deviceTable, eq(devicePortTable.deviceId, deviceTable.id))
      .where(eq(devicePortTable.connectedDeviceId, deviceId))
      .orderBy(asc(deviceTable.code), asc(devicePortTable.portLabel));
    return rows.map((row) => ({
      id: row.port.id,
      portLabel: row.port.portLabel,
      ownerId: row.owner.id,
      ownerCode: row.owner.code,
    }));
  }
}
