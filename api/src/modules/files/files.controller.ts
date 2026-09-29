import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { Audited } from '../audit/audited.decorator';
import { OwnerAccessRegistry } from '../../common/owner-access.registry';
import { ConfigThrottle } from '../../common/config-throttle';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { MULTER_LIMIT } from './file-validation';
import { FILE_OWNER_TYPES, FilesService, type FileOwnerType } from './files.service';
import { NoStepUp } from '../auth/step-up.decorator';

class OwnerDto {
  @IsIn([...FILE_OWNER_TYPES], { message: 'Loại chủ thể đính kèm không hợp lệ.' })
  ownerType!: FileOwnerType;

  @IsUUID(undefined, { message: 'Mã chủ thể đính kèm không hợp lệ.' })
  ownerId!: string;
}

class FileIdParamDto {
  @IsUUID(undefined, { message: 'Mã file không hợp lệ.' })
  id!: string;
}

/**
 * Đính kèm giấy tờ (FR-002) — module file DÙNG CHUNG cho mọi chủ thể.
 *
 * ===== QUYỀN =====
 *
 * Với thiết bị và phần mềm, "mọi vai đã đăng nhập đều xem được" là đúng: hóa đơn thiết bị là
 * thứ cả team IT cần xem hằng ngày.
 *
 * Nhưng `service_account` và `isp` cũng mang đính kèm, và két có ma trận quyền ba tầng với mặc
 * định là CẤM. Không siết ở đây thì một Member bị `denied` trên một tài khoản dịch vụ vẫn liệt
 * kê được đính kèm của nó rồi tải từng cái — mà đính kèm loại này hay là biên bản bàn giao,
 * ảnh chụp cấu hình router, tức giấy tờ có thông tin đăng nhập chép ngay trên đó.
 *
 * Nên: với 4 loại chủ thể mà ma trận PHỦ (`SECRET_OWNER_TYPES`), Member phải có quyền trên
 * chủ thể mới đọc được đính kèm của nó. SA/Admin đọc hết. Với `subnet`/`nat_rule` — chủ thể
 * của file nhưng KHÔNG phải của két — không tồn tại khái niệm tầng quyền, nên mọi vai đã đăng
 * nhập đều xem được.
 */
@NoStepUp()
@Controller('api/v1/files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly access: OwnerAccessRegistry,
  ) {}

  /**
   * Member phải có quyền trên chủ thể mới đọc được đính kèm của nó. SA/Admin đi thẳng.
   *
   * Hỏi qua SỔ ĐĂNG KÝ chứ không gọi thẳng `vault`: `files` là module NỀN, cho nó biết tới một
   * module nghiệp vụ cụ thể là đảo chiều phụ thuộc của cả hệ thống (dependency-cruiser chặn
   * đúng chỗ này khi tôi thử cách hiển nhiên). Xem `common/owner-access.registry.ts`.
   *
   * Loại chủ thể chưa có ai canh (`subnet`, `nat_rule`) đi qua: với chúng khái niệm tầng quyền
   * không tồn tại. Mặc-định-cấm nằm TRONG ma trận, không nằm ở đây.
   *
   * VỊ TỪ Ở DẠNG "KHÔNG PHẢI SA/ADMIN", KHÔNG PHẢI "CÓ PHẢI MEMBER".
   *
   * `if (user.role !== 'member') return;` nghe giống nhưng hỏng ngược: nó cho MỌI vai khác
   * `member` đi thẳng, bỏ qua hoàn toàn ma trận quyền. Đó là mẫu MỞ MẶC ĐỊNH, ngược AD-9.
   * `@Roles` bên dưới chỉ cho ba vai đi qua nên chưa thủng; nhưng ngày thêm vai thứ tư, vai ấy
   * sẽ đọc được mọi giấy tờ đính kèm — biên bản bàn giao, hợp đồng license, file cấu hình VPN —
   * mà không ai hỏi một câu.
   *
   * Cùng vị từ này có họ hàng bên `vault` (`vault.controller.ts` ×2, `vault-device-panel.ts`).
   * Đổi một vị từ quyền thì đi tìm hết họ hàng của nó trước — sót một ổ là để hở một ổ.
   */
  private async assertCanRead(req: AuthedRequest, ownerType: FileOwnerType, ownerId: string) {
    const user = requireUser(req);
    if (user.role === 'sa' || user.role === 'admin') return;
    await this.access.assertCanRead(user.email, ownerType, ownerId);
  }

  @Roles('sa', 'admin', 'member')
  @Get()
  async list(@Query() query: OwnerDto, @Req() req: AuthedRequest) {
    await this.assertCanRead(req, query.ownerType, query.ownerId);
    return this.files.listFor(query.ownerType, query.ownerId);
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  // Upload giữ nguyên buffer 20MB trong RAM — siết theo `rate.file_upload_per_minute` mỗi user.
  @ConfigThrottle('rateFileUploadPerMinute')
  @Audited('file.uploaded', 'file', { writtenByService: true })
  @UseInterceptors(FileInterceptor('file', { limits: MULTER_LIMIT }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: OwnerDto,
    @Req() req: AuthedRequest,
  ) {
    const uploaded = requireFile(file);
    const user = requireUser(req);
    // Đọc được thì mới đính kèm được: không có lý do gì cho phép ghi vào một chủ thể mà chính
    // người đó không được nhìn thấy.
    await this.assertCanRead(req, body.ownerType, body.ownerId);
    return this.files.save({
      buffer: uploaded.buffer,
      originalName: decodeOriginalName(uploaded.originalname),
      ownerType: body.ownerType,
      ownerId: body.ownerId,
      uploadedBy: user.id,
      actor: user.email,
    });
  }

  /**
   * Tải file. LUÔN là `attachment` + `application/octet-stream` + `nosniff`, kể cả với ảnh:
   * AC 2.3 "file đính kèm không render inline dạng HTML". Ai đó upload một file .pdf thực
   * chất chứa HTML thì trình duyệt cũng chỉ tải về, không chạy trong origin của IMS.
   */
  @Roles('sa', 'admin', 'member')
  @Get(':id/download')
  async download(
    @Param() params: FileIdParamDto,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    // Hỏi quyền TRƯỚC khi mở luồng: `openForDownload` ghi audit rồi stream ngay, nên kiểm sau
    // là đã muộn — dữ liệu đã bắt đầu đi ra.
    const owner = await this.files.metaOf(params.id);
    await this.assertCanRead(req, owner.ownerType, owner.ownerId);

    const { meta, stream } = await this.files.openForDownload(
      params.id,
      requireUser(req).email,
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(meta.sizeBytes));
    res.setHeader('Content-Disposition', contentDisposition(meta.originalName));
    // `X-Content-Type-Options: nosniff` KHÔNG set ở đây — helmet đã đặt cho toàn bộ response
    // (app.setup.ts). Set thêm lần nữa ra header trùng "nosniff, nosniff" (E2E bắt được).
    // File mất trên đĩa (row có, đĩa không) → 500 JSON sạch; PHẢI gỡ Content-Length đã set,
    // body rỗng kèm length cũ làm client chờ mãi rồi abort (bắt được ở epic review 1).
    stream.on('error', () => {
      if (!res.headersSent) {
        res.removeHeader('Content-Length');
        res.removeHeader('Content-Disposition');
        res.status(500).json({
          statusCode: 500,
          code: 'FILE_MISSING',
          message: 'File không còn trên ổ lưu trữ. Hãy báo SA.',
        });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  }

  /**
   * XÓA siết về SA/Admin. Mở cho Member thì bất kỳ ai cũng xóa được mọi đính kèm của mọi hồ
   * sơ chỉ cần có id — xóa mềm nên khôi phục được, nhưng không có lý do nghiệp vụ nào để mở
   * đường đó cho toàn bộ vai Member.
   */
  @Roles('sa', 'admin')
  @Delete(':id')
  @Audited('file.deleted', 'file', { writtenByService: true })
  async remove(@Param() params: FileIdParamDto, @Req() req: AuthedRequest) {
    await this.files.remove(requireUser(req).email, params.id);
    return { status: 'deleted' };
  }
}

function requireUser(req: AuthedRequest) {
  if (!req.user) {
    throw new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'Chưa đăng nhập.',
    });
  }
  return req.user;
}

function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file?.buffer?.length) {
    throw new BadRequestException({
      code: 'FILE_REQUIRED',
      message: 'Chưa chọn file để tải lên.',
    });
  }
  return file;
}

/** multer/busboy đọc filename multipart theo latin1 — tên tiếng Việt thành mojibake nếu không decode lại. */
function decodeOriginalName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8');
}

/**
 * Sanitize tên file cho Content-Disposition — chống header injection;
 * tên gốc unicode gửi qua filename* (RFC 5987).
 */
function contentDisposition(originalName: string): string {
  const fallback =
    originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_') || 'download';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
}
