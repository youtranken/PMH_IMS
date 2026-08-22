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
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { MULTER_LIMIT } from './file-validation';
import { FILE_OWNER_TYPES, FilesService, type FileOwnerType } from './files.service';

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
 * Đính kèm giấy tờ (story 2.3, FR-002) — module file DÙNG CHUNG cho mọi chủ thể.
 *
 * Quyền: mọi vai đã đăng nhập. Giấy tờ thiết bị (hóa đơn, biên bản bàn giao) là thứ cả team
 * IT cần xem hằng ngày; thứ cần siết là KÉT SẮT (Epic 4), không phải cái này.
 */
@Controller('api/v1/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Roles('sa', 'admin', 'member')
  @Get()
  list(@Query() query: OwnerDto) {
    return this.files.listFor(query.ownerType, query.ownerId);
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  // Upload giữ nguyên buffer 20MB trong RAM — siết 20 lần/phút/user.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Audited('file.uploaded', 'file', { writtenByService: true })
  @UseInterceptors(FileInterceptor('file', { limits: MULTER_LIMIT }))
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: OwnerDto,
    @Req() req: AuthedRequest,
  ) {
    const uploaded = requireFile(file);
    const user = requireUser(req);
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
          message: 'File không còn trên ổ lưu trữ — báo quản trị hệ thống.',
        });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  }

  @Roles('sa', 'admin', 'member')
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
