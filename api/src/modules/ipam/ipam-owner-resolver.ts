import { Injectable, OnModuleInit } from '@nestjs/common';
import type { OwnerResolver } from '../../common/owner-exists.registry';
import { OwnerExistsRegistry } from '../../common/owner-exists.registry';
import { NatRuleService } from './nat-rule.service';
import { SubnetService } from './subnet.service';

/**
 * `ipam` làm chủ hai loại chủ thể đính kèm: dải mạng và rule NAT.
 *
 * Hai loại này KHÔNG nằm trong `SECRET_OWNER_TYPES` (két sắt không với tới chúng), chỉ có
 * trong `FILE_OWNER_TYPES` — sơ đồ dải, ảnh chụp cấu hình router. Vẫn phải xác minh: một
 * `ownerId` bịa ra ở đây cũng đẻ ra file mồ côi y như mọi loại khác.
 */
@Injectable()
export class IpamOwnerResolver implements OwnerResolver, OnModuleInit {
  readonly ownerTypes = ['subnet', 'nat_rule'] as const;

  constructor(
    private readonly registry: OwnerExistsRegistry,
    private readonly subnets: SubnetService,
    private readonly nat: NatRuleService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelFor(ownerType: string, ownerId: string): Promise<string | null> {
    if (ownerType === 'subnet') {
      const subnet = await this.subnets.findOne(ownerId).catch(() => null);
      return subnet ? `${subnet.cidr} — ${subnet.name}` : null;
    }
    // `findOne` của NAT tra được cả rule ĐÃ GỠ, và đó là đúng: giấy tờ của một rule đã gỡ
    // ("port này từng mở cho ai") chính là thứ đáng đọc nhất khi điều tra.
    const rule = await this.nat.findOne(ownerId).catch(() => null);
    return rule ? `${rule.protocol.toUpperCase()} ${rule.externalFrom}` : null;
  }
}
