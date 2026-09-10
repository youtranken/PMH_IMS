import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { stepUpSecondsLeft } from '../auth/session-policy';
import { RequiresStepUp, StepUpGuard } from '../auth/step-up.guard';
import type { AuthedRequest } from '../auth/types';
import { SystemConfigService } from '../config-sys/system-config.service';
import { BreakGlassService } from './break-glass.service';
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
 * 2. Đường DUY NHẤT lấy được plaintext là `POST :id/reveal`, và nó đòi vừa gõ TOTP xong
 *    (story 4.2). Một secret một lần gọi — không có dạng nhận mảng id.
 *
 * Quyền: SA + Admin. Member không có đường nào tới đây (AD-9, mặc định đóng).
 */
@Controller('api/v1/vault/secrets')
export class VaultController {
  constructor(
    private readonly vault: VaultService,
    private readonly config: SystemConfigService,
    private readonly breakGlass: BreakGlassService,
  ) {}


  /**
   * Member đọc được METADATA của chủ thể nằm trong quyền của mình (story 6.3).
   *
   * Metadata thôi thì không lộ gì — nhưng nó là thứ để họ biết "máy này có mật khẩu admin đã
   * cất" và bấm xin. Không cho đọc thì màn của Member trống trơn và họ không biết phải xin cái
   * gì. Chủ thể ngoài quyền (`denied`) vẫn 403.
   */
  @Roles('sa', 'admin', 'member')
  @Get()
  async list(@Query() query: OwnerQueryDto, @Req() req: AuthedRequest) {
    if (req.user!.role === 'member') {
      await this.breakGlass.assertCanSeeMetadata(actor(req), query.ownerType, query.ownerId);
    }
    return this.vault.listFor(query.ownerType, query.ownerId);
  }

  /** "Tôi làm được gì với chủ thể này" — UI dựng đúng nút bằng MỘT lần gọi (story 6.3). */
  @Roles('sa', 'admin', 'member')
  @Get('verdict')
  verdict(@Query() query: OwnerQueryDto, @Req() req: AuthedRequest) {
    return this.breakGlass.verdictFor(actor(req), query.ownerType, query.ownerId);
  }

  @Roles('sa', 'admin')
  @Get(':id')
  findOne(@Param() params: IdParamDto) {
    return this.vault.findMeta(params.id);
  }

  /*
   * ===== GHI VÀO KÉT CŨNG PHẢI STEP-UP (rà soát 07/09, C2) =====
   *
   * Trước đây ĐỌC thì phải gõ mã 6 số, còn GHI ĐÈ thì không. Một phiên Admin bị chiếm — cookie
   * trộm, máy bỏ ngỏ, chưa từng step-up hoặc đã hết grace — vẫn xoay được mật khẩu switch lõi
   * sang một giá trị kẻ tấn công tự chọn, hoặc thu hồi bí mật đang dùng. Hắn KHÔNG đọc được
   * giá trị cũ, nhưng ĐẶT được giá trị mới rồi dùng chính nó ở nơi khác; và thu hồi là một
   * đường phá hoại thẳng, không cần đọc được gì.
   *
   * Cửa trước khóa kỹ, cửa sau để mở — đúng mẫu N1 của rà soát 07/09.
   *
   * Chi phí cho người dùng thật: một lần gõ mã trong mỗi `secret.stepup_grace_minutes` (10
   * phút), đúng lúc họ đang chủ ý cất/xoay mật khẩu. Web bắt `STEPUP_REQUIRED` rồi mở hộp hỏi
   * mã và thử lại chính việc vừa rồi — xem `useStepUpRetry` trong `web/src/ui`.
   */
  @Roles('sa', 'admin')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @Post()
  @Audited('vault.secret.created', 'secret', { writtenByService: true })
  create(@Body() body: CreateSecretDto, @Req() req: AuthedRequest) {
    return this.vault.create(actor(req), body);
  }

  @Roles('sa', 'admin')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @Patch(':id')
  @Audited('vault.secret.updated', 'secret', { writtenByService: true })
  update(@Param() params: IdParamDto, @Body() body: UpdateSecretDto, @Req() req: AuthedRequest) {
    return this.vault.updateMeta(actor(req), params.id, body);
  }

  @Roles('sa', 'admin')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
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

  /**
   * Mở két (story 4.2, FR-022).
   *
   * POST chứ không GET, và id nằm ở path chứ giá trị KHÔNG bao giờ ở query: GET dễ bị
   * prefetch, lưu vào lịch sử trình duyệt, và lọt vào access log của reverse proxy.
   *
   * `Cache-Control: no-store` là bắt buộc: thiếu nó thì bí mật nằm lại trong bộ nhớ đệm
   * của trình duyệt và bấm Back ở máy dùng chung là hiện lại.
   *
   * Một lần gọi = một secret = một dòng audit (`VaultService.reveal` ghi TRƯỚC khi giải mã).
   *
   * Trần 30 lần/phút THEO USER. Hình dạng route ("một id mỗi lần") một mình KHÔNG đủ để giữ
   * FR-026: phiên đã step-up cứ gọi liệt kê rồi mở lần lượt là rút được cả két trong vài phút,
   * chỉ để lại N dòng audit mà chẳng ai ngồi đọc kịp (code review Epic 4, finding 2). Trần này
   * là hàng rào PHÒNG, còn audit là hàng rào PHÁT HIỆN — cần cả hai. 30 vẫn rộng hơn nhiều so
   * với nhịp người thật (mở một hai mật khẩu rồi đi làm việc khác).
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Roles('sa', 'admin', 'member')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @Post(':id/reveal')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @Audited('vault.secret.revealed', 'secret', { writtenByService: true })
  async reveal(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    const who = actor(req);
    const meta = await this.vault.findMeta(params.id);

    /**
     * Ba tầng của story 6.2 gặp bộ máy duyệt của 6.1 ĐÚNG TẠI ĐÂY, và kiểm ở MỖI lần mở —
     * không cache, không tin một cờ nào trong phiên (AD-6).
     *
     * SA/Admin đi thẳng: quyền của họ đến từ VAI, không từ ma trận. Bắt họ tự gán quyền cho
     * chính mình chỉ tạo ra một bước thừa mà ai cũng sẽ tìm cách bỏ qua.
     */
    let grantId: string | null = null;
    if (req.user!.role === 'member') {
      ({ grantId } = await this.breakGlass.assertCanReveal(who, meta.ownerType, meta.ownerId));
    }

    const [opened, revealSeconds, graceMinutes] = await Promise.all([
      // `grantId` đi vào dòng audit: không có nó thì nhật ký break-glass đứt đúng ở khúc quan
      // trọng nhất — "xem bằng quyền nào" (FR-025).
      this.vault.reveal(who, params.id, grantId),
      // AD-11: bao lâu thì tự ẩn — system_config, không hardcode 30.
      this.config.getNumber('secretRevealSeconds'),
      this.config.getNumber('secretStepUpGraceMinutes'),
    ]);
    /*
     * Hộp hiện secret đếm ngược HAI số: `60s / 600s`.
     *
     * Trái = giá trị này còn hiện bao lâu. Phải = còn mở được két bao lâu nữa mà không phải gõ
     * lại mã 6 số. Con số phải PHẢI do server nói: client không biết `stepped_up_at`, và tự
     * đếm từ lần gõ mã gần nhất thì mỗi tab ra một số khác nhau.
     */
    return {
      ...opened,
      revealSeconds,
      stepUpSecondsLeft: stepUpSecondsLeft(req.user!.steppedUpAt, graceMinutes, new Date()),
    };
  }

  /** "Xóa" = thu hồi mềm. Ciphertext ở lại để còn đối chiếu khi điều tra sự cố. */
  @Roles('sa', 'admin')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
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
