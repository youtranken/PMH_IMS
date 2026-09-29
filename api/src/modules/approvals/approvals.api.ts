import { Injectable } from '@nestjs/common';
import type { Page } from '../../common/pagination';
import type { Tx } from '../../common/tx';
import {
  ApprovalsService,
  type ApprovalRecord,
  type CreateApprovalInput,
  type TransitionInput,
} from './approvals.service';

/**
 * Hợp đồng KIỂU của module — tái xuất ở đây để nơi gọi không phải chạm `approvals.service`.
 * (Trước 28/08 hai module `dashboard` và `vault` phải import thẳng service chỉ để lấy
 *  `ApprovalRecord`, vì cửa chính không đủ dùng — đúng loại vi phạm AD-2 mà luật CI bỏ sót.)
 */
export type { ApprovalRecord, CreateApprovalInput, TransitionInput } from './approvals.service';

/**
 * AD-2: public api DUY NHẤT của module `approvals`.
 *
 * Dùng bởi: break-glass (Epic 6), phiếu ISO (Epic 8), phiếu sự cố (Epic 9). Các module đó
 * KHÔNG query bảng `approval` — chúng đăng ký từ vựng state của mình vào `ApprovalKindRegistry`
 * rồi gọi qua đây.
 */
@Injectable()
export class ApprovalsApiService {
  constructor(private readonly approvals: ApprovalsService) {}

  createWithin(tx: Tx, input: CreateApprovalInput): Promise<ApprovalRecord> {
    return this.approvals.createWithin(tx, input);
  }

  transition(id: string, input: TransitionInput): Promise<ApprovalRecord> {
    return this.approvals.transition(id, input);
  }

  transitionWithin(tx: Tx, id: string, input: TransitionInput): Promise<ApprovalRecord> {
    return this.approvals.transitionWithin(tx, id, input);
  }

  findOne(id: string): Promise<ApprovalRecord> {
    return this.approvals.findOne(id);
  }

  list(filters: Parameters<ApprovalsService['list']>[0]): Promise<ApprovalRecord[]> {
    return this.approvals.list(filters);
  }

  /** Một trang lọc trong SQL — dùng cho màn hình và trang chủ thay vì `list()`. */
  page(
    filters: Parameters<ApprovalsService['page']>[0],
    paging: Parameters<ApprovalsService['page']>[1],
  ): Promise<Page<ApprovalRecord>> {
    return this.approvals.page(filters, paging);
  }

  history(id: string): ReturnType<ApprovalsService['history']> {
    return this.approvals.history(id);
  }

  /**
   * "Người này còn quyền trên đối tượng kia không" — kiểm bằng ĐỒNG HỒ tại mỗi lần đọc (AD-6).
   * Trả về bản ghi chứ không phải boolean: nơi gọi cần `id` để ghi vào audit "xem bằng grant nào".
   */
  activeGrantFor(
    params: Parameters<ApprovalsService['activeGrantFor']>[0],
  ): Promise<ApprovalRecord | null> {
    return this.approvals.activeGrantFor(params);
  }

  /** Gắn grant vào phiên dùng nó lần đầu (Q-15); `null` = không gắn được (đã gắn / hết giờ). */
  claimWithin(
    tx: Tx,
    id: string,
    input: Parameters<ApprovalsService['claimWithin']>[2],
  ): Promise<ApprovalRecord | null> {
    return this.approvals.claimWithin(tx, id, input);
  }

  /** Grant đã gắn phiên — lượt quét đóng quyền của phiên đã kết thúc (Q-15). */
  claimedGrants(kind: string): ReturnType<ApprovalsService['claimedGrants']> {
    return this.approvals.claimedGrants(kind);
  }

  /** Tài khoản bị vô hiệu hóa: rút phiếu đang chờ của người đó trong `tx` của nơi gọi (Q-15). */
  withdrawPendingOfWithin(
    tx: Tx,
    requester: string,
    input: Parameters<ApprovalsService['withdrawPendingOfWithin']>[2],
  ): Promise<number> {
    return this.approvals.withdrawPendingOfWithin(tx, requester, input);
  }

  pending(kind?: string): Promise<ApprovalRecord[]> {
    return this.approvals.pending(kind);
  }
}
