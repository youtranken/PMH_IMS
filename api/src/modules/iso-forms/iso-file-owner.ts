import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { OwnerExistsRegistry, type OwnerResolver, type Uploader } from '../../common/owner-exists.registry';
import { SystemConfigService } from '../config-sys/system-config.service';
import { IsoAccessService } from './iso-access.service';
import { IsoIncidentService } from './iso-incident.service';
import { IsoPeriodStore, periodLabel } from './iso-period.store';
import type { IsoFormType } from './iso-rules';

/** Đuôi trong `iso.scan_types` → loại nội dung mà `files` nhận diện theo magic-byte. */
const MIME_OF: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * `iso-forms` làm chủ hai loại chủ thể đính kèm: bản scan đã ký của kỳ (`iso_period`) và của từng
 * phiếu 0206 (`iso_incident`). Chỉ nhận khi kỳ / phiếu đã khoá — bản ký của một phiếu còn sửa
 * được thì sẽ cũ ngay lần sửa sau. Tải bản ký đẩy kỳ sang Hoàn tất nên là một lượt GHI phiếu: chỉ
 * người phụ trách loại phiếu đó và SA/Admin (Q-28); `files` chỉ kiểm "được xem".
 */
@Injectable()
export class IsoFileOwner implements OwnerResolver, OnModuleInit {
  readonly ownerTypes = ['iso_period', 'iso_incident'] as const;

  constructor(
    private readonly registry: OwnerExistsRegistry,
    private readonly periods: IsoPeriodStore,
    private readonly incidents: IsoIncidentService,
    private readonly access: IsoAccessService,
    private readonly config: SystemConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelFor(ownerType: string, ownerId: string): Promise<string | null> {
    if (ownerType === 'iso_period') {
      const row = await this.periods.findById(ownerId);
      return row ? `Kỳ ${periodLabel(row.formType, row.year, row.month)}` : null;
    }
    const incident = await this.incidents.get(ownerId).catch(() => null);
    return incident ? `Phiếu ${incident.code}` : null;
  }

  async assertAccepts(ownerType: string, ownerId: string, file: { mime: string; sizeBytes: number }, uploader: Uploader): Promise<void> {
    const types = (await this.config.getString('isoScanTypes'))
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const allowed = new Set(types.map((t) => MIME_OF[t]).filter(Boolean));
    if (!allowed.has(file.mime)) {
      throw new BadRequestException({
        code: 'ISO_SCAN_TYPE',
        message: `Bản ký chỉ nhận ${types.map((t) => t.toUpperCase()).join(', ')}.`,
      });
    }
    const maxMb = await this.config.getNumber('isoScanMaxMb');
    if (file.sizeBytes > maxMb * 1024 * 1024) {
      throw new BadRequestException({ code: 'ISO_SCAN_TOO_LARGE', message: `Bản ký tối đa ${maxMb} MB.` });
    }
    if (ownerType === 'iso_period') {
      const row = await this.periods.findById(ownerId);
      if (row?.state !== 'locked') {
        throw new ConflictException({
          code: 'ISO_SIGN_NOT_LOCKED',
          message: 'Kỳ chưa được duyệt chốt — tải bản ký sau khi SA/Admin duyệt.',
        });
      }
      await this.access.assertCanWrite(uploader, row.formType as IsoFormType);
      return;
    }
    const incident = await this.incidents.get(ownerId);
    await this.incidents.assertCanWrite(uploader, incident);
    if (!incident.locked) {
      throw new ConflictException({
        code: 'ISO_SIGN_NOT_LOCKED',
        message:
          incident.status === 'in_progress'
            ? `Phiếu ${incident.code} còn In Progress — đổi sang Resolved rồi mới in và tải bản ký.`
            : `Phiếu ${incident.code} chưa khoá — tải bản ký sau khi kỳ của phiếu được duyệt chốt.`,
      });
    }
  }
}
