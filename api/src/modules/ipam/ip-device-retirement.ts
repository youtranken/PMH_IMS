import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DeviceReleaser } from '../../common/device-retirement.registry';
import { DeviceRetirementRegistry } from '../../common/device-retirement.registry';
import type { Tx } from '../../common/tx';
import { IpAddressService } from './ip-address.service';
import { NatRuleService } from './nat-rule.service';

/**
 * Những gì IPAM đang giữ hộ một thiết bị, và cách trả lại lúc thanh lý.
 *
 * `ipam` tự cắm vào sổ — `devices` không phải biết IPAM tồn tại. Xem
 * `common/device-retirement.registry.ts` để biết vì sao phải đi đường vòng này (chiều thẳng
 * tạo vòng phụ thuộc: `ipam` vốn đã import `devices.api`).
 */
@Injectable()
export class IpDeviceRetirement implements DeviceReleaser, OnModuleInit {
  readonly name = 'ipam';

  constructor(
    private readonly registry: DeviceRetirementRegistry,
    private readonly addresses: IpAddressService,
    private readonly nat: NatRuleService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async holdingsOf(tx: Tx, deviceId: string): Promise<string[]> {
    /*
     * Đọc bằng CHÍNH `tx` — lý do y hệt cái đã ghi ở `releaseWithin` ngay bên dưới, và bản
     * trước bỏ sót đúng một nửa: "đọc trên kết nối khác thì một IP vừa được cấp cho máy này
     * sẽ không có trong danh sách, và máy được thanh lý khi vẫn đang giữ nó."
     *
     * Câu đó đúng cho đường DỌN thì cũng đúng cho đường CHẶN, thậm chí đúng hơn: đường chặn
     * là đường mặc định, `cleanup` chỉ chạy khi người trực chủ động tick ô.
     */
    const ips = await this.addresses.listForDeviceWithin(tx, deviceId);
    const rules = await this.nat.rulesTouchingDevice(
      tx,
      deviceId,
      ips.map((ip) => ip.address),
    );

    const out: string[] = [];
    for (const ip of ips) out.push(`địa chỉ IP ${ip.address}`);
    for (const rule of rules) out.push(`luật NAT ${rule.label}`);
    return out;
  }

  async releaseWithin(tx: Tx, actor: string, deviceId: string): Promise<void> {
    // Đọc bằng CHÍNH `tx`, không phải `this.db`: đọc trên kết nối khác thì một IP vừa được cấp
    // cho máy này sẽ không có trong danh sách, và máy được thanh lý khi vẫn đang giữ nó.
    const ips = await this.addresses.listForDeviceWithin(tx, deviceId);
    const addresses = ips.map((ip) => ip.address);

    /*
     * THỨ TỰ Ở ĐÂY LÀ BẮT BUỘC: gỡ rule NAT TRƯỚC, thu hồi IP SAU.
     *
     * Làm ngược lại thì chính hàng rào của mình chặn mình: `transitionWithin` gọi
     * `assertNoLiveNatWithin` và ném `IP_HAS_LIVE_NAT` (rà soát 07/09 #6), rồi cả lượt thanh
     * lý rollback — người trực bấm Thanh lý và nhận một lỗi nói về NAT mà họ không hề đụng tới.
     *
     * Đây không phải chi tiết vặt: nó là lý do `DeviceReleaser` để mỗi module TỰ lo thứ tự bên
     * trong phần của mình, thay vì sổ đăng ký áp một thứ tự chung.
     */
    await this.nat.voidForDeviceWithin(
      tx,
      actor,
      deviceId,
      addresses,
      `Thiết bị đã thanh lý (dọn tự động)`,
    );

    for (const ip of ips) {
      // Đi qua `transitionWithin` chứ không tự UPDATE: máy trạng thái, CAS và hai dòng sổ
      // (`ip_history` + audit) phải là MỘT bản với đường bấm tay.
      await this.addresses.transitionWithin(tx, actor, ip.id, 'free', {
        reason: 'Thiết bị đã thanh lý',
      });
    }
  }
}
