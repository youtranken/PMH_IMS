import { Injectable } from '@nestjs/common';
import { IpAddressService, type IpAddressRecord } from './ip-address.service';
import { SubnetService, type SubnetWithUsage } from './subnet.service';

/**
 * AD-2: public api DUY NHẤT của module `ipam`.
 *
 * Dùng bởi: panel IP trên trang thiết bị (5.4), sổ NAT trỏ tới IP trong (5.3), bảng điều khiển
 * (7.1), và về sau là phiếu bàn giao (Epic 8). Các module đó KHÔNG được query bảng
 * `subnet`/`ip_address`.
 */
@Injectable()
export class IpamApiService {
  constructor(
    private readonly addresses: IpAddressService,
    private readonly subnets: SubnetService,
  ) {}

  /**
   * Mọi dải còn sống, kèm mức sử dụng đã tính sẵn (`percent`/`used`/`free`).
   *
   * Trả về TẤT CẢ chứ không nhận tham số "chỉ lấy dải trên X%": ngưỡng "thế nào là sắp đầy"
   * là luật của bên gọi (bảng điều khiển đọc nó từ `system_config`), không phải của ipam.
   * Nhét ngưỡng vào đây là chôn một con số nghiệp vụ của module khác vào module này.
   *
   * Vài chục dải nên lấy hết rồi lọc trong bộ nhớ là chuyện vặt — đổi lại, ipam không phải
   * biết bảng điều khiển tồn tại.
   */
  listSubnets(): Promise<SubnetWithUsage[]> {
    return this.subnets.list();
  }

  /** IP đang gắn với một thiết bị. Rỗng = thiết bị chưa có IP nào. */
  listForDevice(deviceId: string): Promise<IpAddressRecord[]> {
    return this.addresses.listForDevice(deviceId);
  }

  /** Hồ sơ IP theo id — sổ NAT (5.3) cần để hiện IP trong kèm chủ. */
  findOne(id: string): Promise<IpAddressRecord> {
    return this.addresses.findOne(id);
  }
}
