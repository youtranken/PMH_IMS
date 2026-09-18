import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { AuditWriterService } from '../audit/audit-writer.service';
import { AuditApiService } from '../audit/audit.api';
import { Roles } from '../auth/roles.decorator';
import { stepUpSecondsLeft } from '../auth/session-policy';
import { NoStepUp, RequiresStepUp } from '../auth/step-up.decorator';
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
/*
 * `@NoStepUp()` ở cấp lớp là MẶC ĐỊNH của controller này, không phải lời khẳng định rằng két
 * sắt không cần gõ mã. Năm cửa cần thì ghi đè bằng `@RequiresStepUp()` ngay trên route — và
 * nhờ vậy mỗi dòng `@RequiresStepUp()` dưới đây đọc ra đúng một ý: "cửa NÀY khác các cửa kia".
 *
 * `@UseGuards(StepUpGuard)` trên từng route đã bỏ: từ 10/09 guard chạy toàn cục (`app.module`),
 * nên gắn tay ở đây vừa thừa vừa gợi ý sai rằng route không gắn thì không được canh.
 */
@NoStepUp()
@Controller('api/v1/vault/secrets')
export class VaultController {
  constructor(
    private readonly vault: VaultService,
    private readonly config: SystemConfigService,
    private readonly breakGlass: BreakGlassService,
    private readonly audit: AuditWriterService,
    private readonly probe: AuditApiService,
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
    /* Mặc định ĐÓNG (AD-9): hỏi "không phải SA/Admin" chứ không hỏi "có phải Member" — vai
       thứ tư thêm vào ngày nào cũng phải đi qua ma trận quyền, không được đi thẳng. */
    if (req.user!.role !== 'sa' && req.user!.role !== 'admin') {
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
  @RequiresStepUp()
  @Post()
  @Audited('vault.secret.created', 'secret', { writtenByService: true })
  create(@Body() body: CreateSecretDto, @Req() req: AuthedRequest) {
    return this.vault.create(actor(req), body);
  }

  @Roles('sa', 'admin')
  @RequiresStepUp()
  @Patch(':id')
  @Audited('vault.secret.updated', 'secret', { writtenByService: true })
  update(@Param() params: IdParamDto, @Body() body: UpdateSecretDto, @Req() req: AuthedRequest) {
    return this.vault.updateMeta(actor(req), params.id, body);
  }

  @Roles('sa', 'admin')
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
  @RequiresStepUp()
  @Post(':id/reveal')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @Audited('vault.secret.revealed', 'secret', { writtenByService: true })
  async reveal(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    const who = actor(req);
    /*
     * MỌI LƯỢT KHÔNG MỞ ĐƯỢC ĐỀU PHẢI ĐỂ LẠI VẾT (17/09/2026).
     *
     * Trước bản này nhật ký chỉ có lượt THÀNH CÔNG: `findMeta` ném 404, hoặc `assertCanReveal`
     * ném 403, đều xảy ra TRƯỚC khi `vault.reveal()` chạy — mà dòng audit lại nằm bên trong
     * hàm đó, và `@Audited(..., writtenByService: true)` nghĩa là lớp chặn ngoài cũng không
     * ghi hộ. Nên "ai đã mở" thì có, "ai đã thử mà bị chặn" thì không ở đâu cả — trong khi
     * chính chú thích trên endpoint này gọi audit là hàng rào PHÁT HIỆN.
     *
     * Dòng vết KHÔNG mang nhãn ngăn: nhãn chính là thứ người này không được phép biết, viết
     * vào nhật ký là mở một đường rò thứ hai ngay trong hàng rào vừa dựng.
     */
    return this.watched(who, params.id, async () => {
      const meta = await this.vault.findMeta(params.id);

    /**
     * Ba tầng của story 6.2 gặp bộ máy duyệt của 6.1 ĐÚNG TẠI ĐÂY, và kiểm ở MỖI lần mở —
     * không cache, không tin một cờ nào trong phiên (AD-6).
     *
     * SA/Admin đi thẳng: quyền của họ đến từ VAI, không từ ma trận. Bắt họ tự gán quyền cho
     * chính mình chỉ tạo ra một bước thừa mà ai cũng sẽ tìm cách bỏ qua.
     */
    let grantId: string | null = null;
    /* Mặc định ĐÓNG (AD-9) — xem chú thích cùng luật ở `list()` bên trên. */
    if (req.user!.role !== 'sa' && req.user!.role !== 'admin') {
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
    });
  }

  /**
   * Chạy một lượt mở két và GHI VẾT NẾU HỎNG.
   *
   * Ghi rồi ném lại nguyên lỗi cũ — người gọi vẫn nhận đúng mã 404/403 như trước, không đổi
   * một chữ nào ở phía client. `code` đi vào vết để sau này phân biệt được ba tình huống rất
   * khác nhau: id không có thật, có thật nhưng ngoài quyền, và có thật nhưng cần xin duyệt.
   */
  /**
   * `code` nghiệp vụ trong thân lỗi HTTP của Nest, đọc từ một giá trị `unknown`.
   *
   * Tách ra thành hàm riêng để nơi gọi đọc nó TRƯỚC khi thu hẹp kiểu — xem chú thích tại chỗ.
   * Ba tình huống rất khác nhau đi vào vết nhờ giá trị này: id không có thật, có thật nhưng
   * ngoài quyền, và có thật nhưng cần xin duyệt.
   */
  private static maLoiCua(error: unknown): string {
    const than = (error as { response?: unknown } | null)?.response;
    const ma = (than as { code?: unknown } | null | undefined)?.code;
    return typeof ma === 'string' ? ma : 'UNKNOWN';
  }

  private async watched<T>(who: string, secretId: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      /*
       * CHỈ ĐẾM LƯỢT BỊ TỪ CHỐI, KHÔNG ĐẾM LƯỢT HỎNG (18/09/2026).
       *
       * Bản trước bắt MỌI lỗi, nên ngoài 403/404 nó nuốt trọn cả lỗi giải mã (`crypto.openText`
       * ném khi `key_version` không còn trong chùm chìa, hoặc tag lệch), lỗi DB chớp, lỗi
       * `config.getNumber`. Hai hậu quả cụ thể:
       *
       *   · Một SA mở ba lần một ngăn có ciphertext hỏng — đúng tình huống `secrets/README.md`
       *     mô tả sau khi lỡ xoá dòng chìa cũ — sinh ra ba dòng `reveal_denied` mang
       *     `code: 'UNKNOWN'` kèm một email TỐ CÁO CHÍNH SA ĐÓ đang dò dẫm quanh két, trong
       *     khi sự thật là hệ thống hỏng.
       *   · Lỗi xảy ra SAU khi `vault.reveal()` đã ghi `vault.secret.revealed` để lại cả
       *     "đã mở" lẫn "bị từ chối" cho cùng một lượt gọi — sổ nói hai điều ngược nhau đúng
       *     ở chỗ điều tra viên đọc.
       *
       * Lỗi khác ném thẳng cho `global-exception.filter` xử như 500 thật.
       */
      /*
       * ĐỌC `code` KHI `error` CÒN LÀ `unknown`, trước phép thu hẹp bên dưới. Sau `instanceof`
       * thì TS biết đây là `ForbiddenException | NotFoundException`, mà hai lớp ấy khai
       * `response` là `private` — ép kiểu sang `{ response: … }` lúc đó là lỗi biên dịch
       * TS2352, không phải chuyện phong cách.
       */
      const code = VaultController.maLoiCua(error);
      if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) {
        throw error;
      }
      /*
       * GHI VẾT KHÔNG ĐƯỢC LÀM HỎNG CÂU TRẢ LỜI. `append` là bản NÉM, nên một nhịp DB nghẽn
       * biến 403 đúng của người dùng thành 500 — và chính đường đang bị tấn công là đường dễ
       * nghẽn nhất. Nuốt lỗi ghi, giữ nguyên lỗi gốc; `AuditWriterService` đã tự log.
       */
      try {
        await this.audit.append({
          actor: who,
          action: 'vault.secret.reveal_denied',
          objectType: 'secret',
          objectId: secretId,
          detail: { code },
        });
      } catch {
        /* đã log ở tầng dưới — xem chú thích ngay trên */
      }
      // Đếm và cảnh báo — không ném ra ngoài dù gửi thư hỏng (xem `SecurityProbeService`).
      await this.probe.noteSecurityFailure(who);
      throw error;
    }
  }

  /** "Xóa" = thu hồi mềm. Ciphertext ở lại để còn đối chiếu khi điều tra sự cố. */
  @Roles('sa', 'admin')
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
