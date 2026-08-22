import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { ExpiryService } from './expiry.service';

class RenewDto {
  @IsString() @Length(1, 40) kind!: string;

  @Matches(/^[0-9a-fA-F-]{36}$/, { message: 'Mã hồ sơ không hợp lệ.' })
  id!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Hạn mới phải dạng YYYY-MM-DD.' })
  endDate!: string;
}

/**
 * Màn Expiry tổng hợp (story 3.4, FR-012).
 * Quyền: cả team IT — ai cũng cần biết cái gì sắp hết hạn.
 */
@Controller('api/v1/expiry')
export class ExpiryController {
  constructor(private readonly expiry: ExpiryService) {}

  /** Các loại nguồn đang đăng ký — UI dựng bộ lọc từ đây, không viết cứng danh sách. */
  @Roles('sa', 'admin', 'member')
  @Get('kinds')
  kinds() {
    return this.expiry.kinds();
  }

  @Roles('sa', 'admin', 'member')
  @Get()
  list(@Query() query: { withinDays?: string; kinds?: string; includeExpired?: string }) {
    return this.expiry.list({
      withinDays: query.withinDays ? Number(query.withinDays) : undefined,
      // `?kinds=license,ssl` — nhiều loại một lần, tránh gọi API lặp.
      kinds: query.kinds ? query.kinds.split(',').filter(Boolean) : undefined,
      includeExpired: query.includeExpired !== 'false',
    });
  }

  @Roles('sa', 'admin', 'member')
  @Get('renewals')
  renewals() {
    return this.expiry.recentRenewals();
  }

  @Roles('sa', 'admin', 'member')
  @Post('renew')
  @Audited('expiry.renewed', 'expiry', { writtenByService: true })
  async renew(@Body() body: RenewDto, @Req() req: AuthedRequest) {
    await this.expiry.renew(req.user!.email, body.kind, body.id, body.endDate);
    return { status: 'renewed' };
  }
}
