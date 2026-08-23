import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import {
  SECRET_KINDS,
  SECRET_OWNER_TYPES,
  VaultService,
  type SecretKind,
  type SecretOwnerType,
} from './vault.service';

class OwnerQueryDto {
  @IsIn([...SECRET_OWNER_TYPES], { message: 'Loại chủ thể không hợp lệ.' })
  ownerType!: SecretOwnerType;

  @IsUUID(undefined, { message: 'Mã chủ thể không hợp lệ.' })
  ownerId!: string;
}

class CreateSecretDto {
  @IsIn([...SECRET_OWNER_TYPES], { message: 'Loại chủ thể không hợp lệ.' })
  ownerType!: SecretOwnerType;

  @IsUUID(undefined, { message: 'Mã chủ thể không hợp lệ.' })
  ownerId!: string;

  @IsIn([...SECRET_KINDS], { message: 'Loại secret không hợp lệ.' })
  kind!: SecretKind;

  @IsString() @Length(1, 120) label!: string;
  @IsOptional() @IsString() @Length(0, 120) username?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;

  /** Giá trị cần cất. Đây là trường DUY NHẤT mang plaintext trong cả module — đã redact ở log. */
  @IsString() @Length(1, 4000) value!: string;
}

class UpdateSecretDto {
  @IsOptional() @IsString() @Length(1, 120) label?: string;
  @IsOptional() @IsString() @Length(0, 120) username?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class RotateSecretDto {
  @IsString() @Length(1, 4000) value!: string;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã secret không hợp lệ.' })
  id!: string;
}

/**
 * Két sắt (story 4.1, FR-021/FR-026, AD-4).
 *
 * Hai luật hình thành nên toàn bộ mặt tiền này:
 *
 * 1. KHÔNG có `GET /secrets` trần. Muốn xem danh sách phải nói rõ đang xem chủ thể NÀO —
 *    `ownerType` + `ownerId` bắt buộc. Đây chính là FR-026 cài vào hình dạng route: không
 *    tồn tại đường nào trả về nhiều hơn một chủ thể, nên không có gì để mà lỡ gọi, lỡ mở
 *    quyền, hay lỡ thêm `?limit=99999`.
 * 2. KHÔNG có endpoint xem giá trị. Ở 4.1 plaintext chỉ đi VÀO. Đường ra là story 4.2 và
 *    phải qua TOTP step-up.
 *
 * Quyền: SA + Admin. Member không có đường nào tới đây (AD-9, mặc định đóng).
 */
@Controller('api/v1/vault/secrets')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Roles('sa', 'admin')
  @Get()
  list(@Query() query: OwnerQueryDto) {
    return this.vault.listFor(query.ownerType, query.ownerId);
  }

  @Roles('sa', 'admin')
  @Get(':id')
  findOne(@Param() params: IdParamDto) {
    return this.vault.findMeta(params.id);
  }

  @Roles('sa', 'admin')
  @Post()
  @Audited('vault.secret.created', 'secret', { writtenByService: true })
  create(@Body() body: CreateSecretDto, @Req() req: AuthedRequest) {
    return this.vault.create(actor(req), body);
  }

  @Roles('sa', 'admin')
  @Patch(':id')
  @Audited('vault.secret.updated', 'secret', { writtenByService: true })
  update(@Param() params: IdParamDto, @Body() body: UpdateSecretDto, @Req() req: AuthedRequest) {
    return this.vault.updateMeta(actor(req), params.id, body);
  }

  @Roles('sa', 'admin')
  @Post(':id/rotate')
  @Audited('vault.secret.rotated', 'secret', { writtenByService: true })
  async rotate(
    @Param() params: IdParamDto,
    @Body() body: RotateSecretDto,
    @Req() req: AuthedRequest,
  ) {
    await this.vault.rotate(actor(req), params.id, body.value);
    return { ok: true };
  }

  /** "Xóa" = thu hồi mềm. Ciphertext ở lại để còn đối chiếu khi điều tra sự cố. */
  @Roles('sa', 'admin')
  @Delete(':id')
  @Audited('vault.secret.revoked', 'secret', { writtenByService: true })
  async revoke(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    await this.vault.revoke(actor(req), params.id);
    return { ok: true };
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}
