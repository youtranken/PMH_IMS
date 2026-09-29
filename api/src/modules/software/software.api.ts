import { Injectable } from '@nestjs/common';
import type { StatusEvent } from '../../common/history';
import type { Page } from '../../common/pagination';
import { IspLineService, type IspLineListItem } from './isp-line.service';
import { SoftwareService } from './software.service';
import type { SoftwareListItem } from './software.types';

/**
 * AD-2: public api DUY NHẤT của module `software`.
 * Dùng bởi: cỗ máy expiry hỏi "sắp hết hạn gì", két sắt gắn secret vào hồ sơ phần mềm,
 * dashboard đếm số sắp hết hạn.
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

  /** Hồ sơ phần mềm đã bỏ — màn Kho thanh lý gom qua đây. */
  async listRetired(): Promise<SoftwareListItem[]> {
    return (await this.retiredPage()).items;
  }

  /** Như `listRetired`, kèm `total` thật để kho biết mình có bị cắt ở trần 500 dòng không. */
  retiredPage(): Promise<Page<SoftwareListItem>> {
    return this.software.list({ page: 1, limit: 500 }, { status: 'retired' });
  }

  /** Đường truyền đã thanh lý — màn Kho thanh lý gom qua đây, cùng lối với `listRetired`. */
  async listTerminatedIsp(): Promise<IspLineListItem[]> {
    return (await this.terminatedIspPage()).items;
  }

  terminatedIspPage(): Promise<Page<IspLineListItem>> {
    return this.isp.list({ page: 1, limit: 500 }, { status: 'terminated' });
  }

  /** Ai thanh lý hồ sơ phần mềm, khi nào, tự động (Q-13) hay bằng tay. */
  retirementEvents(ids: string[]): Promise<Map<string, StatusEvent>> {
    return this.software.retirementEvents(ids);
  }

  /** Như `retirementEvents`, cho đường truyền đã thanh lý. */
  ispTerminationEvents(ids: string[]): Promise<Map<string, StatusEvent>> {
    return this.isp.terminationEvents(ids);
  }
}
