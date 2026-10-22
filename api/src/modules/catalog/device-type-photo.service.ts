import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { photoThumbnail, type PhotoImage } from '../../common/photo-thumbnail';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { SystemConfigService } from '../config-sys/system-config.service';
import { FilesApiService } from '../files/files.api';
import { deviceTypeTable } from './catalog.schema';
import { CatalogService } from './catalog.service';
import type { CatalogEntity } from './catalog.types';

const DEVICE_TYPE: CatalogEntity = 'device_type';

/**
 * Ảnh riêng của loại thiết bị (PW-A18): khung ảnh trống của máy chưa có ảnh thật (máy, model)
 * hiện ảnh này, không có thì biểu tượng của loại. Tách khỏi `CatalogService` vì chỉ chỗ này cần
 * kho tệp.
 */
@Injectable()
export class DeviceTypePhotoService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly catalog: CatalogService,
    private readonly files: FilesApiService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Chọn / bỏ ảnh. Ảnh phải là ảnh còn sống tải lên cho CHÍNH loại này — không mượn được giấy tờ
   * của hồ sơ khác. Ảnh bị thay / bỏ vào thùng rác cùng transaction (như ảnh thiết bị, Q-26):
   * ảnh của loại không có màn Giấy tờ nào để người dùng tự dọn.
   */
  async setPhoto(actor: string, typeId: string, fileId: string | null): Promise<void> {
    const type = await this.catalog.deviceTypeById(typeId);
    if (!type) throw new NotFoundException({ code: 'CATALOG_NOT_FOUND', message: 'Không tìm thấy loại thiết bị này.' });
    if (fileId) {
      const file = (await this.files.imagesByIds([fileId])).get(fileId);
      if (!file || file.ownerType !== 'device_type' || file.ownerId !== typeId) {
        throw new BadRequestException({
          code: 'DEVICE_TYPE_PHOTO_INVALID',
          message: 'Ảnh chọn phải là ảnh (jpg/png/webp) vừa tải lên cho chính loại này.',
        });
      }
    }
    const before = type?.photoFileId ?? null;
    if (before === fileId) return;
    await this.db.transaction(async (tx) => {
      await tx.update(deviceTypeTable).set({ photoFileId: fileId, updatedAt: new Date() }).where(eq(deviceTypeTable.id, typeId));
      await this.catalog.recordWithin(tx, actor, DEVICE_TYPE, typeId, fileId ? 'photo_set' : 'photo_removed', {
        photoFileId: { before, after: fileId },
      });
      if (before) await this.files.trashWithin(tx, actor, [before]);
    });
  }

  /** Ảnh đã thu nhỏ, hoặc `null` khi loại không có ảnh / ảnh đã xoá / không đọc được. */
  async preview(typeId: string): Promise<PhotoImage | null> {
    const type = await this.catalog.deviceTypeById(typeId);
    const fileId = type?.photoFileId;
    if (!fileId) return null;
    const [maxPx, maxMegapixels, source] = await Promise.all([
      this.config.getNumber('diagramPhotoMaxPx'),
      this.config.getNumber('fileMaxImageMegapixels'),
      this.files.readImage(fileId),
    ]);
    return source ? photoThumbnail(source.bytes, source.mime, maxPx, maxMegapixels) : null;
  }
}
