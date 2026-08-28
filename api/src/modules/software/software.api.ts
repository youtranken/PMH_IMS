import { Injectable } from '@nestjs/common';
import { IspLineService, type IspLineListItem } from './isp-line.service';
import { SoftwareService } from './software.service';
import type { SoftwareListItem } from './software.types';

/**
 * AD-2: public api DUY NHẤT của module `software`.
 * Epic sau dùng: cỗ máy expiry (3.4) hỏi "sắp hết hạn gì", két sắt (Epic 4) gắn secret vào
 * hồ sơ phần mềm, dashboard (Epic 7) đếm số sắp hết hạn.
 */
@Injectable()
export class SoftwareApiService {
  constructor(
    private readonly software: SoftwareService,
    private readonly isp: IspLineService,
  ) {}

  getById(id: string): Promise<SoftwareListItem> {
    return this.software.findOne(id);
  }

  async exists(id: string): Promise<boolean> {
    try {
      await this.software.findOne(id);
      return true;
    } catch {
      return false;
    }
  }

  /** Cỗ máy expiry gọi qua đây — engine KHÔNG được SELECT bảng `software` (AD-7). */
  findExpiringBetween(from: string, to: string): Promise<SoftwareListItem[]> {
    return this.software.findExpiringBetween(from, to);
  }

  /** Màn Expiry bấm "đã gia hạn" → gọi về đúng module chủ (AC 3.4). */
  renew(actor: string, id: string, newEnd: string): Promise<unknown> {
    return this.software.renew(actor, id, newEnd);
  }

  /*
   * Đường truyền cũng đi qua CỬA NÀY.
   *
   * `isp_line` là bảng riêng nhưng chưa có module chủ riêng — nó sống trong `software` (ghi
   * nhận trong docs/DANH-GIA-LIEN-KET.md, tách module để phase sau). Chừng nào còn vậy thì
   * public api của nó cũng ở đây, chứ KHÔNG để module khác import thẳng `isp-line.service`.
   */
  getIspById(id: string): Promise<IspLineListItem> {
    return this.isp.findOne(id);
  }
}
