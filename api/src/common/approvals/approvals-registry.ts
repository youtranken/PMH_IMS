import { Global, Injectable, Module } from '@nestjs/common';
import { ApprovalFlow, type ApprovalFlowSpec } from './approval-flow';

/**
 * Sổ đăng ký LOẠI yêu cầu duyệt (AD-6).
 *
 * Nằm ở `common` chứ không trong module `approvals` — cùng lý do với `ExpirySourceRegistry`
 * và `DevicePanelRegistry`: cả bên GHI (module nghiệp vụ đăng ký loại của mình) lẫn bên ĐỌC
 * (`approvals` chạy máy trạng thái) đều cần chạm, nên nó không thuộc về bên nào. Để trong
 * `approvals` thì mọi module muốn đăng ký đều phải import nội bộ của `approvals` — depcruise
 * đã bắt đúng lỗi này một lần ở Epic 2 rồi.
 *
 * `@Global` để module chủ chỉ cần inject, không phải import chéo module của nhau.
 */
@Injectable()
export class ApprovalKindRegistry {
  private readonly flows = new Map<string, ApprovalFlow>();

  register(spec: ApprovalFlowSpec): void {
    this.flows.set(spec.kind, new ApprovalFlow(spec));
  }

  /**
   * `null` = loại chưa đăng ký. Trả null thay vì ném để nơi gọi tự chọn cách xử: service
   * ném 400 tiếng Việt, còn sweep thì bỏ qua và đi tiếp — một loại hỏng không được làm chết
   * cả vòng quét (bài học finding 2 của Epic 3).
   */
  find(kind: string): ApprovalFlow | null {
    return this.flows.get(kind) ?? null;
  }

  kinds(): string[] {
    return [...this.flows.keys()];
  }
}

@Global()
@Module({
  providers: [ApprovalKindRegistry],
  exports: [ApprovalKindRegistry],
})
export class ApprovalsRegistryModule {}
