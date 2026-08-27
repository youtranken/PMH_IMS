import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import {
  SERVICE_ACCOUNT_KINDS,
  type ServiceAccountKind,
  type ServiceAccountStatus,
} from './service-account-rules';
import {
  SERVICE_ACCOUNT_SORT_DEFAULT,
  SERVICE_ACCOUNT_SORT_KEYS,
  ServiceAccountService,
} from './service-account.service';

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã tài khoản dịch vụ không hợp lệ.' })
  id!: string;
}

class ServiceAccountBodyDto {
  @IsString()
  @Length(1, 64, { message: 'Mã tài khoản từ 1 đến 64 ký tự.' })
  code!: string;

  @IsIn([...SERVICE_ACCOUNT_KINDS], { message: 'Loại tài khoản không hợp lệ.' })
  kind!: ServiceAccountKind;

  @IsString()
  @Length(1, 160, { message: 'Tên tài khoản từ 1 đến 160 ký tự.' })
  name!: string;

  @IsOptional() @IsString() @Length(0, 160) login?: string;
  @IsOptional() @IsString() @Length(0, 120) department?: string;
  @IsOptional() @IsString() @Length(0, 120) ownerName?: string;
  @IsOptional() @IsString() @Length(0, 120) groupName?: string;
  /** Danh sách IP/CIDR ngăn bằng phẩy hoặc xuống dòng — luật ở `service-account-rules.ts`. */
  @IsOptional() @IsString() @Length(0, 2000) allowedIps?: string;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;

  /*
   * KHÔNG có `status` — xem chú thích ở `ServiceAccountInput`. Đổi trạng thái đi qua
   * `:id/disable` và `:id/enable`, hai đường bắt ghi lý do.
   */
}

class DisableDto {
  @IsString()
  @Length(3, 500, { message: 'Lý do vô hiệu hóa từ 3 ký tự.' })
  reason!: string;
}

class EnableDto {
  @IsString()
  @Length(3, 500, { message: 'Lý do bật lại từ 3 ký tự.' })
  reason!: string;
}

/**
 * Tài khoản dịch vụ (0032): tài khoản DÙNG CHUNG (email kế toán, cổng VNPT…) và tài khoản VPN.
 *
 * Quyền: đọc thì mọi vai đã đăng nhập — biết công ty có những tài khoản nào là việc bình
 * thường của team IT. GHI thì chỉ SA/Admin, cùng mức với danh mục và két sắt: một tài khoản
 * dùng chung bị sửa sai là cả phòng mất đường đăng nhập.
 *
 * Mật khẩu KHÔNG nằm ở đây — nó ở két sắt với `ownerType: 'service_account'`.
 */
@Controller('api/v1/service-accounts')
export class ServiceAccountController {
  constructor(private readonly accounts: ServiceAccountService) {}

  @Roles('sa', 'admin', 'member')
  @Get()
  list(
    @Query()
    query: {
      page?: string;
      limit?: string;
      search?: string;
      kind?: ServiceAccountKind;
      status?: ServiceAccountStatus;
      sort?: string;
      dir?: string;
    },
  ) {
    return this.accounts.list(
      parsePageQuery(query),
      { search: query.search, kind: query.kind, status: query.status },
      parseSortQuery(query, SERVICE_ACCOUNT_SORT_KEYS, SERVICE_ACCOUNT_SORT_DEFAULT),
    );
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id')
  findOne(@Param() params: IdParamDto) {
    return this.accounts.findOne(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @Get(':id/history')
  history(@Param() params: IdParamDto) {
    return this.accounts.history(params.id);
  }

  @Roles('sa', 'admin')
  @Post()
  @Audited('service_account.created', 'service_account', { writtenByService: true })
  create(@Body() body: ServiceAccountBodyDto, @Req() req: AuthedRequest) {
    return this.accounts.create(actor(req), body);
  }

  @Roles('sa', 'admin')
  @Patch(':id')
  @Audited('service_account.updated', 'service_account', { writtenByService: true })
  update(
    @Param() params: IdParamDto,
    @Body() body: ServiceAccountBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.accounts.update(actor(req), params.id, body);
  }

  /** "Xóa" = vô hiệu hóa kèm lý do — không DELETE thật, xem chú thích ở service. */
  @Roles('sa', 'admin')
  @Patch(':id/disable')
  @Audited('service_account.disabled', 'service_account', { writtenByService: true })
  disable(@Param() params: IdParamDto, @Body() body: DisableDto, @Req() req: AuthedRequest) {
    return this.accounts.disable(actor(req), params.id, body.reason);
  }

  /** Bật lại — cũng bắt lý do, đối xứng với `:id/disable`. */
  @Roles('sa', 'admin')
  @Patch(':id/enable')
  @Audited('service_account.enabled', 'service_account', { writtenByService: true })
  enable(@Param() params: IdParamDto, @Body() body: EnableDto, @Req() req: AuthedRequest) {
    return this.accounts.enable(actor(req), params.id, body.reason);
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}
