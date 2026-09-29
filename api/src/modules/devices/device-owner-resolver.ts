import { Injectable, OnModuleInit } from '@nestjs/common';
import type { OwnerResolver } from '../../common/owner-exists.registry';
import type { Tx } from '../../common/tx';
import { OwnerExistsRegistry } from '../../common/owner-exists.registry';
import { DevicesService } from './devices.service';

/** `devices` làm chủ loại chủ thể `device` (xem `common/owner-exists.registry.ts`). */
@Injectable()
export class DeviceOwnerResolver implements OwnerResolver, OnModuleInit {
  readonly ownerTypes = ['device'] as const;

  constructor(
    private readonly registry: OwnerExistsRegistry,
    private readonly devices: DevicesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelFor(_ownerType: string, ownerId: string): Promise<string | null> {
    /*
     * CỐ Ý không loại thiết bị đã thanh lý ở đây. Sổ này chỉ trả lời "có thật không"; còn
     * "có nhận thêm được không" là câu của `DevicesApiService.assertUsable`. Gộp hai câu vào
     * một sẽ chặn luôn việc XEM và TẢI giấy tờ của máy đã thanh lý — mà biên bản thanh lý
     * chính là thứ người ta cần đọc nhất sau khi máy đã đi.
     */
    const device = await this.devices.findOne(ownerId).catch(() => null);
    return device ? `${device.code} — ${device.name}` : null;
  }

  /**
   * Câu THỨ HAI: "máy này còn nhận thêm được không".
   *
   * Ba đường ghi của port map, IP, license đều gọi hàng rào này, và KÉT SẮT cũng phải gọi.
   * Trang chi tiết thiết bị dạy người dùng rằng "máy đã thanh lý thì két chỉ đọc"
   * (`canEdit={canVaultWrite && !retired}`); nếu két không hỏi ở đây thì màn `/vault` — vốn
   * không xét trạng thái hồ sơ — ghi được thật. Một trong hai màn nói dối, và không test nào
   * bắt được vì cả hai đều xanh.
   *
   * Uỷ quyền cho `DevicesService` chứ không tự so `status`: câu "còn nhận thêm được không" và
   * câu chữ của lỗi chỉ được có MỘT bản (AD-15).
   */
  async assertUsableWithin(tx: Tx, _ownerType: string, ownerId: string): Promise<void> {
    await this.devices.assertUsableWithin(tx, ownerId);
  }
}
