import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import {
  ApprovalKindRegistry,
  type ApprovalSubject,
} from '../../common/approvals/approvals-registry';
import { UI_PATHS } from '../../common/ui-paths';
import { UsersApiService } from '../users/users.api';
import {
  ApprovalsApiService,
  type ApprovalRecord,
  type TransitionInput,
} from '../approvals/approvals.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import { conflictOnUnique } from '../../common/sql';
import { OutboxService } from '../outbox/outbox.service';
import { AccessListService } from './access-list.service';
import { tierLabel, type AccessTier } from './access-tier';
import { VaultOwnersService } from './vault-owners.service';
import { VaultService, type SecretOwnerType } from './vault.service';

export const BREAK_GLASS_KIND = 'break_glass';

/**
 * Từ vựng state của break-glass (AD-6). `approvals` không biết những chữ này — nó chỉ biết
 * chạy một máy trạng thái mà loại yêu cầu mang tới.
 *
 * `approved → revoked` có mặt vì một lý do rất thực: cấp quyền 24 giờ rồi 20 phút sau phát
 * hiện người xin không còn trực nữa. Không có đường đó thì cách duy nhất là chờ hết giờ.
 */
export const BREAK_GLASS_FLOW = {
  kind: BREAK_GLASS_KIND,
  initial: 'pending',
  transitions: {
    pending: ['approved', 'denied', 'cancelled'],
    approved: ['expired', 'revoked'],
    denied: [],
    cancelled: [],
    expired: [],
    revoked: [],
  },
  labels: {
    'pending->approved': 'Duyệt',
    'pending->denied': 'Từ chối',
    'pending->cancelled': 'Người xin tự hủy',
    'approved->expired': 'Hết hạn',
    'approved->revoked': 'Thu hồi sớm',
  },
};

export interface BreakGlassRequestInput {
  ownerType: SecretOwnerType;
  ownerId: string;
  reason: string;
  /** Số giờ xin. Bị kẹp theo `breakglass.max_grant_hours` (AD-11, mặc định 24). */
  hours: number;
}

/**
 * Một phiếu break-glass như người đọc cần thấy — không phải một uuid.
 *
 * Người duyệt lúc 2 giờ sáng phải biết "switch truy cập tầng 1 hay firewall biên" để đánh giá
 * rủi ro. Chỉ có mã, tên, site và SỐ ngăn két — không bao giờ có tên ngăn (FR-026).
 */
export interface BreakGlassView extends ApprovalRecord {
  /** `mã · tên · site`; `null` khi hồ sơ chủ đã bị xoá. */
  subjectLabel: string | null;
  requesterName: string;
  /** Số ngăn két của đối tượng — chỉ người duyệt nhận; người xin nhận `null`. */
  secretCount: number | null;
}

/** Đường tới két của từng loại hồ sơ — đích của nút "Mở két" trong thư báo được duyệt. */
export const VAULT_TAB_PATH: Record<SecretOwnerType, (id: string) => string> = {
  device: (id) => `${UI_PATHS.device(id)}?tab=vault`,
  software: (id) => `${UI_PATHS.software(id)}?tab=vault`,
  isp: (id) => `${UI_PATHS.ispLine(id)}?tab=vault`,
  service_account: (id) => `${UI_PATHS.serviceAccount(id)}?tab=vault`,
};

/** Kết quả kiểm quyền của một người trên một chủ thể — UI dựng nút theo cái này. */
export interface AccessVerdict {
  tier: AccessTier;
  tierLabel: string;
  /** Xem được ngay bây giờ không (whitelist, hoặc cần duyệt mà đang có grant còn hạn). */
  canReveal: boolean;
  /** Gửi yêu cầu được không (cần duyệt, và chưa có yêu cầu nào đang treo/còn hạn). */
  canRequest: boolean;
  grant: ApprovalRecord | null;
  pending: ApprovalRecord | null;
}

/**
 * Break-glass (story 6.3, FR-023, AD-6).
 *
 * Ba tầng của 6.2 gặp bộ máy duyệt của 6.1 tại đây. Điểm cốt lõi — và là câu gắt nhất của
 * AD-6 — nằm ở `assertCanReveal`: hiệu lực kiểm tại MỖI lần đọc bằng đồng hồ, không tin status.
 */
@Injectable()
export class BreakGlassService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly kinds: ApprovalKindRegistry,
    private readonly approvals: ApprovalsApiService,
    private readonly access: AccessListService,
    private readonly config: SystemConfigService,
    private readonly outbox: OutboxService,
    private readonly owners: VaultOwnersService,
    private readonly vault: VaultService,
    private readonly users: UsersApiService,
  ) {}

  onModuleInit(): void {
    this.kinds.register(BREAK_GLASS_FLOW);
    // `mail` là tầng nền, không import được `vault` (AD-2) — nên dạy sổ cách gọi tên đối tượng.
    this.kinds.registerDescriber(BREAK_GLASS_KIND, (type, id) =>
      this.describeSubject(type as SecretOwnerType, id),
    );
  }

  /** Mã + tên + site của đối tượng, hoặc `null` khi hồ sơ đã bị xoá. */
  async describeSubject(ownerType: SecretOwnerType, ownerId: string): Promise<ApprovalSubject | null> {
    const pathOf = VAULT_TAB_PATH[ownerType];
    if (!pathOf) return null;
    const owner = await this.owners.describe(ownerType, ownerId);
    if (owner.orphan) return null;
    return {
      code: owner.code,
      label: [owner.code, owner.name, owner.siteCode].filter(Boolean).join(' · '),
      path: pathOf(ownerId),
    };
  }

  /**
   * Gắn tên đối tượng + tên người xin vào từng phiếu.
   *
   * Một lượt tra cho mỗi đối tượng KHÁC NHAU, không phải mỗi phiếu: một máy hay bị xin nhiều
   * lần trong nhật ký. `withCount` chỉ bật cho người duyệt — số ngăn là thông tin của bản đồ két.
   */
  async views(rows: ApprovalRecord[], withCount: boolean): Promise<BreakGlassView[]> {
    const subjects = new Map<string, Promise<[ApprovalSubject | null, number | null]>>();
    for (const row of rows) {
      const key = `${row.subjectType}:${row.subjectId}`;
      if (subjects.has(key)) continue;
      const type = row.subjectType as SecretOwnerType;
      subjects.set(
        key,
        Promise.all([
          this.describeSubject(type, row.subjectId),
          withCount ? this.vault.countFor(type, row.subjectId) : Promise.resolve(null),
        ]),
      );
    }
    const names = await this.users.namesByEmails([...new Set(rows.map((r) => r.requester))]);
    return Promise.all(
      rows.map(async (row) => {
        const [subject, secretCount] = await subjects.get(`${row.subjectType}:${row.subjectId}`)!;
        return {
          ...row,
          subjectLabel: subject?.label ?? null,
          requesterName: names.get(row.requester) ?? row.requester,
          secretCount,
        };
      }),
    );
  }

  /**
   * Một phiếu — trang chi tiết mở từ nút trong thư.
   *
   * Người duyệt đọc được mọi phiếu; Member chỉ đọc phiếu CỦA CHÍNH MÌNH. Phiếu của người khác
   * trả CÙNG lỗi với phiếu không tồn tại: đoán id mà phân biệt được "có nhưng cấm" với "không có"
   * là lộ ra ai đang xin mở két gì.
   */
  async detail(viewer: string, canDecide: boolean, id: string): Promise<BreakGlassView> {
    const row = await this.requireBreakGlass(id);
    if (!canDecide && row.requester.toLowerCase() !== viewer.toLowerCase()) {
      // Đúng từng chữ của `approvals.findOne` khi id không tồn tại.
      throw new NotFoundException({
        code: 'APPROVAL_NOT_FOUND',
        message: 'Không tìm thấy yêu cầu này.',
      });
    }
    const [view] = await this.views([row], canDecide);
    return view;
  }

  /**
   * Số phiếu NGƯỜI NÀY duyệt được — badge menu. Không đếm phiếu của chính họ: bốn mắt
   * (FR-023) cấm tự duyệt, nên đếm vào là báo một việc họ không làm được.
   */
  async pendingCountFor(approver: string): Promise<number> {
    const rows = await this.approvals.pending(BREAK_GLASS_KIND);
    return rows.filter((r) => r.requester.toLowerCase() !== approver.toLowerCase()).length;
  }

  /** UI hỏi "tôi làm được gì với chủ thể này" — một lần gọi, đủ để dựng đúng nút. */
  async verdictFor(
    memberEmail: string,
    ownerType: SecretOwnerType,
    ownerId: string,
  ): Promise<AccessVerdict> {
    const tier = await this.access.tierFor(memberEmail, ownerType, ownerId);

    if (tier === 'denied') {
      return {
        tier,
        tierLabel: tierLabel(tier),
        canReveal: false,
        canRequest: false,
        grant: null,
        pending: null,
      };
    }
    if (tier === 'whitelist') {
      return {
        tier,
        tierLabel: tierLabel(tier),
        canReveal: true,
        canRequest: false,
        grant: null,
        pending: null,
      };
    }

    const [grant, pending] = await Promise.all([
      this.approvals.activeGrantFor({
        kind: BREAK_GLASS_KIND,
        requester: memberEmail,
        subjectType: ownerType,
        subjectId: ownerId,
      }),
      this.pendingOf(memberEmail, ownerType, ownerId),
    ]);

    return {
      tier,
      tierLabel: tierLabel(tier),
      canReveal: grant !== null,
      // Đang có grant còn hạn hoặc đang có yêu cầu treo thì KHÔNG xin thêm — hai yêu cầu
      // cùng nội dung chỉ làm người duyệt phải quyết hai lần cho một việc.
      canRequest: grant === null && pending === null,
      grant,
      pending,
    };
  }

  /**
   * Hàng rào ở đường đọc METADATA. Nhẹ hơn `assertCanReveal`: chỉ cần KHÔNG bị cấm.
   *
   * Cần-duyệt mà chưa có grant vẫn xem được tên gọi — đó chính là thứ để họ biết phải xin cái
   * gì. Không cho thì màn của Member trống trơn và họ phải đi hỏi người khác "máy này có mật
   * khẩu gì", tức là quay về đúng cái tình trạng cuốn sổ này sinh ra để bỏ.
   */
  async assertCanSeeMetadata(
    memberEmail: string,
    ownerType: SecretOwnerType,
    ownerId: string,
  ): Promise<void> {
    const tier = await this.access.tierFor(memberEmail, ownerType, ownerId);
    if (tier === 'denied') {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'Bạn không có quyền trên đối tượng này.',
      });
    }
  }

  /**
   * Hàng rào ở đường ĐỌC secret. Gọi tại MỖI lần mở két, không cache (AD-6).
   *
   * Trả về id của grant đã dùng (hoặc null nếu whitelist) để nơi gọi ghi vào audit — không có
   * nó thì nhật ký break-glass đứt đúng ở khúc quan trọng nhất: "xem bằng quyền nào".
   */
  async assertCanReveal(
    memberEmail: string,
    ownerType: SecretOwnerType,
    ownerId: string,
  ): Promise<{ tier: AccessTier; grantId: string | null }> {
    const tier = await this.access.tierFor(memberEmail, ownerType, ownerId);

    if (tier === 'whitelist') return { tier, grantId: null };

    if (tier === 'denied') {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'Bạn không có quyền trên đối tượng này. Liên hệ quản trị nếu cần.',
      });
    }

    const grant = await this.approvals.activeGrantFor({
      kind: BREAK_GLASS_KIND,
      requester: memberEmail,
      subjectType: ownerType,
      subjectId: ownerId,
    });
    if (!grant) {
      throw new ForbiddenException({
        code: 'BREAK_GLASS_REQUIRED',
        message: 'Cần được duyệt trước khi xem. Gửi yêu cầu kèm lý do và thời hạn.',
      });
    }
    return { tier, grantId: grant.id };
  }

  /**
   * Member gửi yêu cầu. Ghi yêu cầu + đẩy email báo người duyệt TRONG CÙNG transaction (AD-5).
   *
   * Tách hai transaction thì có cửa sổ mà yêu cầu đã nằm trong DB còn email thì không bao giờ
   * đi — người xin ngồi chờ một người duyệt không hề biết có việc. Lúc 2 giờ sáng thì cửa sổ
   * đó là cả đêm.
   */
  async request(memberEmail: string, input: BreakGlassRequestInput): Promise<ApprovalRecord> {
    const tier = await this.access.tierFor(memberEmail, input.ownerType, input.ownerId);
    if (tier === 'denied') {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'Bạn không có quyền trên đối tượng này — xin cũng không được.',
      });
    }
    if (tier === 'whitelist') {
      throw new BadRequestException({
        code: 'ACCESS_ALREADY_GRANTED',
        message: 'Bạn đã xem thẳng được đối tượng này, không cần xin.',
      });
    }

    /**
     * Kiểm sớm cho thông điệp tử tế — nhưng ném CÙNG MỘT loại lỗi với hàng rào DB bên dưới.
     *
     * Trước đây chỗ này ném 400 còn ràng buộc DB ném 409: cùng một sai lầm của người dùng mà
     * trả hai mã khác nhau tùy vào việc request thứ hai tới trước hay sau khi cái thứ nhất kịp
     * commit. Client không thể xử lý tử tế một API đổi mã theo nhịp gõ phím, và test thì đỏ
     * ngẫu nhiên — đúng cách bộ E2E đầy đủ phát hiện ra chuyện này.
     */
    const existing = await this.pendingOf(memberEmail, input.ownerType, input.ownerId);
    if (existing) {
      throw new ConflictException({
        code: 'BREAK_GLASS_PENDING',
        message: 'Bạn đã có một yêu cầu đang chờ duyệt cho đối tượng này.',
      });
    }

    const hours = await this.clampHours(input.hours);

    try {
      return await this.db.transaction(async (tx) => {
        const created = await this.approvals.createWithin(tx, {
          kind: BREAK_GLASS_KIND,
          requester: memberEmail,
          subjectType: input.ownerType,
          subjectId: input.ownerId,
          reason: input.reason,
          payload: { hours },
        });
        // Outbox chỉ mang id tham chiếu, KHÔNG PII (AD-11/NFR-04).
        await this.outbox.enqueueWithin(tx, 'approval.requested', { approvalId: created.id });
        return created;
      });
    } catch (error) {
      /**
       * Ràng buộc `approval_one_pending_key` của DB — hàng rào THẬT cho luật "một yêu cầu
       * đang treo cho mỗi chủ thể".
       *
       * Câu kiểm `pendingOf()` phía trên chạy NGOÀI transaction nên hai cú bấm "Gửi yêu cầu"
       * cùng lúc (hoặc một lần thử lại) đều thấy "chưa có" và cùng ghi — người duyệt phải
       * quyết hai lần cho một việc, và cái thứ hai nằm treo mãi sau khi cái thứ nhất được
       * duyệt (code review Epic 6, finding 6).
       */
      throw conflictOnUnique(
        error,
        {
          code: 'BREAK_GLASS_PENDING',
          message: 'Bạn đã có một yêu cầu đang chờ duyệt cho đối tượng này.',
        },
        // Khai ĐÍCH DANH: bảng `approval` còn khóa chính, và một 23505 từ chỗ khác mà hiện ra
        // câu "bạn đã có yêu cầu đang chờ" là nói sai hẳn việc vừa xảy ra.
        'approval_one_pending_key',
      );
    }
  }

  /**
   * Người duyệt chốt. `hours` cho phép RÚT NGẮN so với yêu cầu — người duyệt nhìn lý do rồi
   * quyết, chứ không phải bấm đồng ý với con số người xin tự đặt.
   */
  async approve(
    approver: string,
    id: string,
    options: { hours?: number; note?: string | null } = {},
  ): Promise<ApprovalRecord> {
    const request = await this.requireBreakGlass(id);
    /*
     * BỐN MẮT (FR-023) — người xin không tự duyệt cho chính mình.
     *
     * `POST /vault/break-glass` mở cho cả `member`, `admin` và `sa` ("ai cũng XIN được, kể cả
     * Admin"), còn `approve` mở cho `sa`/`admin`. Tới 10/09 `approve()` KHÔNG so `approver`
     * với `request.requester` — trong khi `cancel()` ngay bên dưới thì có, và có vì đúng lý do
     * này (code review Epic 6, finding 1).
     *
     * Tác động quyền hạn chế: Admin vốn đã đi thẳng qua ma trận nên grant không cho thêm gì.
     * Nhưng nhật ký FR-025 thì in ra một grant "đã được duyệt" nhìn hợp lệ hoàn toàn, với
     * `decided_by` là chính người xin — và đó là thứ auditor đọc. Nguyên tắc bốn mắt mất đi
     * không phải vì ai đó phá được nó, mà vì nó chưa từng được cài.
     */
    if (request.requester.toLowerCase() === approver.toLowerCase()) {
      throw new ForbiddenException({
        code: 'CANNOT_APPROVE_OWN_REQUEST',
        message:
          'Không tự duyệt yêu cầu của chính mình được — phải là người khác duyệt (FR-023). ' +
          'Nhờ một Quản trị viên khác, hoặc hủy yêu cầu nếu đã hết cần.',
      });
    }
    const asked = Number((request.payload as { hours?: number } | null)?.hours ?? 0);
    const hours = await this.clampHours(options.hours ?? asked);

    return this.decide(id, {
      to: 'approved',
      actor: approver,
      note: options.note,
      expiresAt: new Date(Date.now() + hours * 3_600_000),
      detail: { hours },
    });
  }

  async deny(approver: string, id: string, note?: string | null): Promise<ApprovalRecord> {
    await this.requireBreakGlass(id);
    return this.decide(id, { to: 'denied', actor: approver, note });
  }

  /** Thu hồi sớm — người xin không còn trực nữa thì không phải chờ hết giờ. */
  async revoke(approver: string, id: string, note?: string | null): Promise<ApprovalRecord> {
    await this.requireBreakGlass(id);
    return this.decide(id, { to: 'revoked', actor: approver, note });
  }

  /**
   * Quyết định + thư báo người xin TRONG CÙNG transaction (AD-5, Q-14).
   *
   * Tách ra thì hoặc người xin nhận thư "đã duyệt" cho một quyết định đã rollback (hai người
   * cùng bấm, người sau thua), hoặc quyết định đã vào sổ mà thư không bao giờ đi — người xin
   * lại ngồi F5 lúc 2 giờ sáng. Payload mang `state` vì thư phải nói quyết định ĐÃ xảy ra, không
   * phải state lúc worker kịp gửi.
   */
  private decide(id: string, input: TransitionInput): Promise<ApprovalRecord> {
    return this.db.transaction(async (tx) => {
      const decided = await this.approvals.transitionWithin(tx, id, input);
      await this.outbox.enqueueWithin(tx, 'approval.decided', {
        approvalId: id,
        state: input.to,
      });
      return decided;
    });
  }

  /**
   * Người xin tự hủy — việc đã xong trước khi ai kịp duyệt.
   *
   * Chỉ hủy được yêu cầu CỦA CHÍNH MÌNH. Không kiểm thì bất kỳ ai biết id (nhìn qua vai, ảnh
   * chụp màn hình, URL bị chia sẻ) đều giết được yêu cầu của người khác — người xin ngồi chờ
   * tiếp lúc 2 giờ sáng, còn lịch sử thì ghi tên người hủy sai
   * (code review Epic 6, finding 1).
   */
  async cancel(requester: string, id: string): Promise<ApprovalRecord> {
    const request = await this.requireBreakGlass(id);
    if (request.requester.toLowerCase() !== requester.toLowerCase()) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_REQUEST',
        message: 'Chỉ người gửi mới hủy được yêu cầu này.',
      });
    }
    return this.approvals.transition(id, { to: 'cancelled', actor: requester });
  }

  /**
   * Đúng LOẠI break-glass, không phải một yêu cầu của module khác.
   *
   * Bảng `approval` dùng chung cho mọi luồng duyệt (AD-6). Không kiểm `kind` thì khi Epic 8/9
   * cắm phiếu ISO và phiếu sự cố vào cùng bảng, các endpoint của két sắt trở thành một cửa hậu
   * lái yêu cầu của module khác — bỏ qua luật riêng của họ, và để lại một dòng audit ghi
   * `iso_form.approved` phát ra từ `/vault/break-glass/...` (code review Epic 6, finding 4).
   */
  private async requireBreakGlass(id: string): Promise<ApprovalRecord> {
    const request = await this.approvals.findOne(id);
    if (request.kind !== BREAK_GLASS_KIND) {
      throw new NotFoundException({
        code: 'APPROVAL_NOT_FOUND',
        message: 'Không tìm thấy yêu cầu break-glass này.',
      });
    }
    return request;
  }

  async pendingForApprovers(): Promise<BreakGlassView[]> {
    return this.views(await this.approvals.pending(BREAK_GLASS_KIND), true);
  }

  async mine(memberEmail: string, paging: PageQuery): Promise<Page<BreakGlassView>> {
    const page = await this.approvals.page(
      { kind: BREAK_GLASS_KIND, requester: memberEmail },
      { limit: paging.limit, offset: pageOffset(paging) },
    );
    return { ...page, items: await this.views(page.items, false) };
  }

  /** FR-025: nhật ký break-glass, từng trang cho màn hình. */
  async log(paging: PageQuery): Promise<Page<BreakGlassView>> {
    const page = await this.approvals.page(
      { kind: BREAK_GLASS_KIND },
      { limit: paging.limit, offset: pageOffset(paging) },
    );
    return { ...page, items: await this.views(page.items, true) };
  }

  /** Trọn nhật ký — chỉ cho file xuất nộp auditor, nơi thiếu dòng là sai. */
  logAll(): Promise<ApprovalRecord[]> {
    return this.approvals.list({ kind: BREAK_GLASS_KIND });
  }

  private async pendingOf(
    memberEmail: string,
    ownerType: SecretOwnerType,
    ownerId: string,
  ): Promise<ApprovalRecord | null> {
    const rows = await this.approvals.list({
      kind: BREAK_GLASS_KIND,
      state: 'pending',
      requester: memberEmail,
      subjectType: ownerType,
      subjectId: ownerId,
    });
    return rows[0] ?? null;
  }

  /**
   * Kẹp số giờ theo trần cấu hình (AD-11).
   *
   * Kẹp chứ không TỪ CHỐI: người xin lúc 2 giờ sáng gõ đại "72 giờ" thì cho họ 24 và nói rõ,
   * còn hơn bắt họ đoán đúng con số rồi mới được gửi. Sàn 1 giờ để không có grant 0 giờ —
   * một grant hết hạn ngay lúc sinh ra trông y như hệ thống hỏng.
   */
  private async clampHours(requested: number): Promise<number> {
    const configured = await this.config.getNumber('breakGlassMaxGrantHours');
    /**
     * Trần cấu hình cũng có SÀN 1 giờ.
     *
     * Đặt `breakglass.max_grant_hours = 0` (gõ nhầm, hoặc tưởng 0 nghĩa là "tắt") thì mọi grant
     * hết hạn ĐÚNG LÚC SINH RA — được duyệt xong mà vẫn không xem được, trông y hệt hệ thống
     * hỏng và không có dòng lỗi nào. Muốn tắt break-glass thì gỡ quyền ở ma trận 6.2, không
     * phải hạ trần xuống 0 (code review Epic 6, finding 5).
     */
    const max = Math.max(1, configured);
    const asked = !Number.isFinite(requested) || requested <= 0 ? 1 : Math.round(requested);
    return Math.max(1, Math.min(asked, max));
  }
}
