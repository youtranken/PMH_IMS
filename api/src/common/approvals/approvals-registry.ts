import { Global, Injectable, Module } from '@nestjs/common';
import { ApprovalFlow, type ApprovalFlowSpec } from './approval-flow';

/**
 * Chủ thể của một yêu cầu, ở dạng người đọc hiểu được.
 *
 * Người duyệt lúc 2 giờ sáng phải biết "máy nào" để đánh giá rủi ro; một uuid không cho họ biết
 * gì. Chỉ có mã, tên, site và đường tới hồ sơ — không bao giờ có tên hay giá trị secret, vì thứ
 * này đi vào email, là thứ dễ chuyển tiếp nhất trong cả hệ thống.
 */
export interface ApprovalSubject {
  /** Mã hồ sơ (vd `SW-CORE-01`) — đủ ngắn để đứng trong tiêu đề thư. */
  code: string;
  /** `mã · tên · site` — dòng đầy đủ cho thân thư và màn duyệt. */
  label: string;
  /** Đường UI (tương đối, không host) tới chỗ dùng quyền vừa cấp. */
  path: string;
}

export type ApprovalSubjectDescriber = (
  subjectType: string,
  subjectId: string,
) => Promise<ApprovalSubject | null>;

/**
 * Sổ đăng ký LOẠI yêu cầu duyệt (AD-6).
 *
 * Nằm ở `common` chứ không trong module `approvals` — cùng lý do với `ExpirySourceRegistry`
 * và `DevicePanelRegistry`: cả bên GHI (module nghiệp vụ đăng ký loại của mình) lẫn bên ĐỌC
 * (`approvals` chạy máy trạng thái) đều cần chạm, nên nó không thuộc về bên nào. Để trong
 * `approvals` thì mọi module muốn đăng ký đều phải import nội bộ của `approvals` — depcruise
 * chặn đúng lỗi này.
 *
 * `@Global` để module chủ chỉ cần inject, không phải import chéo module của nhau.
 */
@Injectable()
export class ApprovalKindRegistry {
  private readonly flows = new Map<string, ApprovalFlow>();
  private readonly describers = new Map<string, ApprovalSubjectDescriber>();

  register(spec: ApprovalFlowSpec): void {
    this.flows.set(spec.kind, new ApprovalFlow(spec));
  }

  /**
   * `null` = loại chưa đăng ký. Trả null thay vì ném để nơi gọi tự chọn cách xử: service
   * ném 400 tiếng Việt, còn sweep thì bỏ qua và đi tiếp — một loại hỏng không được làm chết
   * cả vòng quét.
   */
  find(kind: string): ApprovalFlow | null {
    return this.flows.get(kind) ?? null;
  }

  kinds(): string[] {
    return [...this.flows.keys()];
  }

  /**
   * Module chủ của loại yêu cầu dạy sổ cách gọi tên chủ thể. `mail` là tầng nền, không được
   * import `vault` (AD-2), nên chiều đi ngược: vault ghi vào sổ, mail đọc sổ.
   */
  registerDescriber(kind: string, describer: ApprovalSubjectDescriber): void {
    this.describers.set(kind, describer);
  }

  /** `null` khi loại chưa dạy cách gọi tên, hoặc hồ sơ không còn — nơi gọi tự lùi về chữ chung. */
  async describe(
    kind: string,
    subjectType: string,
    subjectId: string,
  ): Promise<ApprovalSubject | null> {
    const describer = this.describers.get(kind);
    return describer ? describer(subjectType, subjectId) : null;
  }
}

@Global()
@Module({
  providers: [ApprovalKindRegistry],
  exports: [ApprovalKindRegistry],
})
export class ApprovalsRegistryModule {}
