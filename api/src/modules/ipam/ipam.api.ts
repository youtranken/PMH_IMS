import { Injectable } from '@nestjs/common';
import { IpAddressService, type IpAddressRecord } from './ip-address.service';

/**
 * AD-2: public api DUY NHẤT của module `ipam`.
 *
 * Dùng bởi: panel IP trên trang thiết bị (5.4), sổ NAT trỏ tới IP trong (5.3), và về sau là
 * phiếu bàn giao (Epic 8). Các module đó KHÔNG được query bảng `subnet`/`ip_address`.
 */
@Injectable()
export class IpamApiService {
  constructor(private readonly addresses: IpAddressService) {}

  /** IP đang gắn với một thiết bị. Rỗng = thiết bị chưa có IP nào. */
  listForDevice(deviceId: string): Promise<IpAddressRecord[]> {
    return this.addresses.listForDevice(deviceId);
  }

  /** Hồ sơ IP theo id — sổ NAT (5.3) cần để hiện IP trong kèm chủ. */
  findOne(id: string): Promise<IpAddressRecord> {
    return this.addresses.findOne(id);
  }
}
