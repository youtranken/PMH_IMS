import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { AccessListService } from './access-list.service';
import { SECRET_OWNER_TYPES, type SecretOwnerType } from './vault.service';
import { SCOPE_TYPES, type ScopeType } from './access-tier';
import { NoStepUp, RequiresStepUp } from '../auth/step-up.decorator';

class AccessRuleDto {
  @IsString() @Length(3, 160) memberEmail!: string;

  @IsIn([...SCOPE_TYPES], { message: 'Nhóm đối tượng không hợp lệ.' })
  scopeType!: ScopeType;

  @IsString() @Length(1, 120) scopeRef!: string;

  /**
   * Cố ý KHÔNG nhận 'denied': cấm là MẶC ĐỊNH, muốn cấm thì GỠ lời gán đi.
   *
   * Cho gán 'denied' sẽ sinh ra câu hỏi "dòng cấm có thắng dòng cho phép không" — và câu trả
   * lời nào cũng làm màn ma trận khó đọc hơn, trong khi đây đúng là màn người ta phải đọc
   * được ngay để trả lời auditor "vì sao người này xem được cái kia".
   */
  @IsIn(['whitelist', 'needs_approval'], {
    message: 'Tầng phải là "Xem thẳng" hoặc "Cần duyệt". Muốn cấm thì gỡ lời gán đi.',
  })
  tier!: 'whitelist' | 'needs_approval';

  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

/** Hỏi "người này có tầng gì trên đối tượng kia" — màn ma trận và story 6.3 đều cần. */
class TierQueryDto {
  @IsIn([...SECRET_OWNER_TYPES], { message: 'Loại chủ thể không hợp lệ.' })
  ownerType!: SecretOwnerType;

  @IsUUID(undefined, { message: 'Mã chủ thể không hợp lệ.' })
  ownerId!: string;

  @IsString() @Length(3, 160) memberEmail!: string;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã lời gán không hợp lệ.' })
  id!: string;
}

/**
 * Ma trận quyền xem secret (story 6.2, FR-023).
 *
 * Đường riêng chứ không nằm dưới `/vault/secrets`: đây là CẤU HÌNH quyền, không phải một
 * secret. Nhét chung thì `/vault/secrets/access` phải tranh chỗ với `/vault/secrets/:id`, và
 * thứ tự khai báo route trở thành một hợp đồng ngầm không ai nhớ.
 *
 * Chỉ SA/Admin. Ma trận này là bản đồ phòng thủ của cả hệ thống — Member đọc được nó là biết
 * chính xác chỗ nào yếu.
 */
@NoStepUp()
@Controller('api/v1/vault/access')
export class VaultAccessController {
  constructor(private readonly access: AccessListService) {}

  @Roles('sa', 'admin')
  @Get()
  list(@Query() query: { memberEmail?: string }) {
    return this.access.list(query.memberEmail?.trim().toLowerCase() || undefined);
  }

  /**
   * Danh sách người của màn ma trận — đọc, SA/Admin. Màn này KHÔNG gọi `/accounts`: route đó
   * chỉ SA và trả đủ hồ sơ nhân sự, còn ở đây chỉ cần biết ai là ai để gán quyền.
   */
  @Roles('sa', 'admin')
  @Get('people')
  people() {
    return this.access.people();
  }

  /** Các nhóm gán được — ô chọn của màn ma trận đổ từ đây, không viết cứng ở web. */
  @Roles('sa', 'admin')
  @Get('scopes')
  scopes() {
    return this.access.scopeOptions();
  }

  /**
   * Trả lời "người này có tầng gì trên đối tượng kia, VÌ SAO" — tầng, nhóm của đối tượng và các
   * dòng quyền đã khớp (dòng quyết định đứng đầu). Dùng để kiểm chứng một lời gán vừa tạo có
   * thật sự có tác dụng không. Chỉ SA/Admin: nó đọc ra chính ma trận.
   */
  @Roles('sa', 'admin')
  @Get('tier')
  tier(@Query() query: TierQueryDto) {
    return this.access.explainTierFor(query.memberEmail, query.ownerType, query.ownerId);
  }

  @Roles('sa', 'admin')
  /*
   * Cấp tầng quyền đọc két cho một tài khoản khác. Lập luận của `DELETE /vault/secrets/:id`
   * áp nguyên vào đây, chỉ đổi chiều: thu hồi là phá hoại thẳng, còn cấp quyền là dựng một
   * cửa hậu BỀN — nó sống tiếp cả sau khi phiên đang bị chiếm đã chết.
   */
  @RequiresStepUp()
  @Post()
  @Audited('vault.access.granted', 'access_list', { writtenByService: true })
  grant(@Body() body: AccessRuleDto, @Req() req: AuthedRequest) {
    return this.access.upsert(actor(req), body);
  }

  /** Gỡ = đưa về CẤM mặc định (AD-9 áp vào dữ liệu, không phải vào route). */
  @Roles('sa', 'admin')
  // Gỡ quyền của đội trực. Phá hoại thuần — đúng loại rủi ro mà `revoke` secret được gắn
  // step-up để chặn.
  @RequiresStepUp()
  @Delete(':id')
  @Audited('vault.access.revoked', 'access_list', { writtenByService: true })
  async revoke(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    await this.access.remove(actor(req), params.id);
    return { ok: true };
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}
