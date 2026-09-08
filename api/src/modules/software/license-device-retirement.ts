import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DeviceReleaser } from '../../common/device-retirement.registry';
import { DeviceRetirementRegistry } from '../../common/device-retirement.registry';
import type { Tx } from '../../common/tx';
import { LicenseAssignmentService } from './license-assignment.service';

/**
 * Ghế license mà một thiết bị đang ngồi, và cách trả ghế lúc thanh lý.
 *
 * ===== THANH LÝ MÁY ≠ THANH LÝ PHẦN MỀM =====
 *
 * Đây là ranh giới quan trọng nhất của file này. Thanh lý một MÁY chỉ GỠ MÁY ĐÓ KHỎI license
 * — ghế được trả về, hồ sơ phần mềm không suy suyển gì. Công ty vẫn sở hữu cái license đó và
 * sẽ gán nó cho máy mới ngày mai.
 *
 * ===== VÌ SAO ĐÂY LÀ VIỆC CẤP THIẾT, KHÔNG PHẢI DỌN DẸP CHO ĐẸP =====
 *
 * `usedWithin` đếm mọi dòng gán chưa `released_at`, không quan tâm máy còn hay mất. Nên máy đã
 * thanh lý VẪN ăn ghế, vĩnh viễn. Thanh lý 10 máy cũ thì máy mới đầu tiên đã đụng trần
 * `SEAT_LIMIT_REACHED`, và cửa đó BẮT người trực khai một `overSeatReason` — tức bắt họ viết
 * ra một lý do vượt seat **sai sự thật pháp lý** với nhà cung cấp, để đi tiếp được công việc
 * hằng ngày. Hàng rào chống vượt seat của AC 3.2 tự biến thành cái máy sinh ra lời khai sai.
 */
@Injectable()
export class LicenseDeviceRetirement implements DeviceReleaser, OnModuleInit {
  constructor(
    private readonly registry: DeviceRetirementRegistry,
    private readonly assignments: LicenseAssignmentService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async holdingsOf(deviceId: string): Promise<string[]> {
    // `installedForDevice` chứ không `listForDevice`: nó kèm sẵn mã + tên hồ sơ phần mềm, mà
    // thông điệp chặn phải gọi đúng tên thứ người trực đi gỡ ("Office 2021"), không phải uuid.
    const rows = await this.assignments.installedForDevice(deviceId);
    return rows.map((row) => `ghế license ${row.softwareCode} — ${row.softwareName}`);
  }

  async releaseWithin(tx: Tx, actor: string, deviceId: string): Promise<void> {
    await this.assignments.releaseForDeviceWithin(
      tx,
      actor,
      deviceId,
      'Thiết bị đã thanh lý (dọn tự động)',
    );
  }
}
