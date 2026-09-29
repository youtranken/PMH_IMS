/**
 * AD-7: engine expiry KHÔNG quét bảng của ai. Module nghiệp vụ đăng ký provider,
 * engine chỉ gọi provider + áp luật digest + đẩy mail qua outbox.
 *
 * Module chủ (devices, software…) implement interface này và tự đăng ký; engine chỉ biết
 * interface, không biết bảng nào tồn tại. Vault KHÔNG đăng ký gì (AD-4).
 */
export interface ExpiryItem {
  id: string;
  label: string;
  /**
   * Mã và tên tách riêng (nhãn `label` là "mã — tên"): màn hình in mã mono cạnh tên thường,
   * hộp Gia hạn đặt tiêu đề ngắn bằng mã. Nguồn nào không có mã thì bỏ trống.
   */
  code?: string;
  name?: string;
  /** Mô tả phụ hiện dưới nhãn (nhà cung cấp, site, model…). */
  sublabel?: string | null;
  /** Loại để luật digest lọc: 'license' | 'ssl' | 'domain' | 'warranty' | 'maintenance'… */
  kind: string;
  start: string | null;
  /** Ngày hết hạn, dạng YYYY-MM-DD. */
  end: string;
  /** Đường dẫn UI để email/màn Expiry trỏ về đúng hồ sơ. */
  link: string;
  /**
   * Vẫn hiện trên màn Sắp hết hạn và dashboard, nhưng KHÔNG vào mail digest. Dùng cho hồ sơ
   * phần mềm đã chuyển sang Hết hạn (DOM-03): mail "sắp hết hạn" đã nhắc trước đó rồi.
   */
  quietInDigest?: boolean;
  /**
   * Ngày hệ thống sẽ tự Thanh lý mục đã Hết hạn (Q-13) — chỉ nguồn phần mềm có. Màn Sắp hết hạn
   * là nơi cuối cùng còn kịp cứu, nên nó phải nói ra ngày này.
   */
  autoRetireOn?: string | null;
}

export interface ExpirySource {
  /** Tên nguồn, trùng với `kind` cha để luật digest cấu hình được. */
  readonly sourceKind: string;

  /** Nhãn tiếng Việt của nguồn — màn Expiry và email dùng để đặt tên bộ lọc. */
  readonly sourceLabel: string;

  /** Trả các bản ghi có `end` nằm trong [from, to]. Engine tự quyết cửa sổ. */
  findExpiring(from: string, to: string): Promise<ExpiryItem[]>;

  /**
   * Gia hạn một mục (AC 3.4: "thao tác đã gia hạn gọi api module chủ").
   *
   * Để `undefined` nếu loại đó không gia hạn được từ màn Expiry (vd bảo hành thiết bị —
   * bảo hành do nhà cung cấp quyết, sửa tay trong hồ sơ thiết bị chứ không "gia hạn").
   * Engine chỉ gọi hàm này, không bao giờ tự UPDATE bảng của module khác.
   */
  renew?(actor: string, id: string, newEnd: string, terms?: RenewTerms): Promise<void>;

  /**
   * Nguồn này ghi được số hợp đồng + chi phí của lượt gia hạn vào sổ gia hạn (Q-15). Không
   * bật thì engine từ chối hai trường đó thay vì nuốt im — người nhập tưởng đã lưu mà sổ trống.
   */
  readonly renewTerms?: boolean;
}

/** Hợp đồng + chi phí của RIÊNG một lượt gia hạn (Q-15). Bỏ trống = chưa khai. */
export interface RenewTerms {
  contract?: string | null;
  cost?: number | null;
}
