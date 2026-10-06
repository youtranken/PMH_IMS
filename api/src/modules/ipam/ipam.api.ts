import { Injectable, NotFoundException } from '@nestjs/common';
import { IpAddressService, type IpAddressRecord } from './ip-address.service';
import { isOccupying } from './ip-lifecycle';
import { SubnetService, type SubnetWithUsage } from './subnet.service';
import { ipSearchPattern } from './ip-rules';

/**
 * AD-2: public api DUY NHẤT của module `ipam`.
 *
 * Dùng bởi: panel IP trên trang thiết bị, sổ NAT trỏ tới IP trong, bảng điều khiển, và về sau
 * là phiếu bàn giao. Các module đó KHÔNG được query bảng
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

  /**
   * Id thiết bị đang giữ IP khớp từ khoá (đủ 4 nhóm = khớp đúng, thiếu nhóm = cả nhóm). Từ
   * khoá không phải dạng IP thì trả rỗng — bên gọi không phải tự đoán thế nào là một IP.
   */
  deviceIdsByAddress(term: string): Promise<string[]> {
    const pattern = ipSearchPattern(term);
    return pattern ? this.addresses.deviceIdsByAddress(pattern) : Promise.resolve([]);
  }

  /**
   * IP đang giữ của nhiều máy một lượt (`deviceId → địa chỉ`), cùng luật với cột IP của danh sách
   * thiết bị. Sơ đồ mạng chụp nó vào phiên bản bản vẽ (AD-14).
   */
  heldAddressesOf(deviceIds: string[]): Promise<Map<string, string[]>> {
    return this.addresses.heldAddressesOf(deviceIds);
  }

  /** Hồ sơ IP theo id — sổ NAT (5.3) cần để hiện IP trong kèm chủ. */
  findOne(id: string): Promise<IpAddressRecord> {
    return this.addresses.findOne(id);
  }

  /**
   * Nhiều dải theo id, KỂ CẢ đã ngừng dùng (id không có thì vắng mặt) — sơ đồ mạng kiểm khung VLAN
   * vừa gắn có trỏ vào dải thật, còn dùng không.
   */
  async subnetsByIds(ids: string[]): Promise<Map<string, SubnetWithUsage>> {
    if (ids.length === 0) return new Map();
    const wanted = new Set(ids);
    const all = await this.subnets.list({ includeVoided: true });
    return new Map(all.filter((s) => wanted.has(s.id)).map((s) => [s.id, s]));
  }

  /**
   * Tóm tắt một dải cho thẻ khung VLAN của sơ đồ: mức dùng + `sample` IP trống đầu tiên. "Trống" =
   * địa chỉ chưa có hồ sơ hoặc hồ sơ đang ở trạng thái Trống — cùng luật với màn dải mạng. Dải đã
   * ngừng dùng vẫn trả (cờ `voided`); `null` = không có dải này.
   */
  async subnetSummary(id: string, sample: number): Promise<SubnetSummary | null> {
    let subnet: SubnetWithUsage;
    try {
      subnet = await this.subnets.findOne(id);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
    const slots = await this.addresses.listBySubnet(id);
    const firstFree: string[] = [];
    for (const slot of slots) {
      if (firstFree.length >= sample) break;
      if (slot.kind === 'free' || (!slot.voidedAt && !isOccupying(slot.status))) firstFree.push(slot.address);
    }
    return {
      id: subnet.id,
      name: subnet.name,
      cidr: subnet.cidr,
      vlan: subnet.vlan,
      siteCode: subnet.siteCode,
      gateway: subnet.gateway,
      voided: subnet.voidedAt !== null,
      total: subnet.total,
      used: subnet.used,
      free: subnet.free,
      firstFree,
    };
  }
}

/** Một dải như thẻ khung VLAN của sơ đồ thấy nó. */
export interface SubnetSummary {
  id: string;
  name: string;
  cidr: string;
  vlan: number | null;
  siteCode: string | null;
  gateway: string | null;
  voided: boolean;
  total: number;
  used: number;
  free: number;
  firstFree: string[];
}
