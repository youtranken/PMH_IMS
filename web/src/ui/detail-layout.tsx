import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Chevron } from '@/ui/chevron';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { useMediaQuery } from '@/ui/use-media-query';

/**
 * Bố cục hai cột của MỌI trang chi tiết (AD-15): nội dung bên trái, thẻ định danh bên phải.
 *
 * VÌ SAO THAY `StatGrid`. Dải chỉ số ngang dùng `auto-fit, minmax(180px, 1fr)`, nghĩa là bề
 * ngang mỗi ô phụ thuộc vào SỐ chỉ số vẽ được. Hồ sơ khai sơ sài — tức đa số hồ sơ — chỉ còn
 * hai chỉ số, và hai cái ô phình ra nửa màn hình để chứa chữ "Dự phòng". Cột phải rộng cố
 * định thì bề ngang không còn phụ thuộc dữ liệu.
 *
 * Và nó DÍNH khi cuộn: thứ người trực cần lúc đang đứng cạnh tủ rack — mã, vị trí, trạng
 * thái, còn bao nhiêu ngày bảo hành — không trôi mất khi cuộn xuống đọc bảng port map.
 *
 * LUẬT CHIA VIỆC (giữ đúng thì không bao giờ có chuyện in hai lần một giá trị):
 *   · cột phải = "cái này là gì, ở đâu, của ai, còn hạn không" — thuộc tính của chính hồ sơ;
 *   · cột chính = "nó dính tới cái gì, đã xảy ra chuyện gì" — quan hệ, bảng, lịch sử.
 * Một trường đã nằm ở cột phải thì KHÔNG lặp lại ở lưới bên trái. Đó chính là lỗi của bản
 * trước: trạng thái, bảo hành, nhà cung cấp in ở hai chỗ cách nhau 40px.
 *
 * Dưới 1199px: một cột, và cột phải nhảy LÊN TRƯỚC (`order: -1` trong `css/detail-tabs.css`).
 *
 * Không truyền `rail` thì một cột trơn: trang đã nói mọi thuộc tính ở dải 4 ô (Q-27) và không
 * còn thẻ riêng nào cho cột phải.
 */
export function DetailLayout({
  rail,
  railSummary,
  railStrip = false,
  children,
}: {
  rail?: ReactNode;
  /**
   * Dải một dòng thay cho thẻ định danh trên điện thoại (≤680px): thẻ đầy đủ đứng TRƯỚC thanh
   * tab và dài ~600px, nên tab nằm tận dưới màn. Có prop này thì thẻ thu vào nút "Chi tiết",
   * dải tóm tắt (trạng thái · vị trí · người dùng) vẫn luôn thấy. Không truyền → như cũ.
   */
  railSummary?: ReactNode;
  /**
   * Thu thẻ định danh thành DẢI NGANG một dòng (`railSummary`) ở đầu cột chính, và cột chính
   * chiếm trọn bề ngang. Dùng cho các tab là BẢNG (cổng, két, giấy tờ, lịch sử): cột phải 320px
   * ăn mất chỗ và bảng bị cắt cột Thao tác. Thẻ đầy đủ chỉ cần ở tab tổng quan.
   */
  railStrip?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const narrow = useMediaQuery(RAIL_COLLAPSE_QUERY);
  const [open, setOpen] = useState(false);
  /* Không có `railSummary` thì một cột trơn: trang đã có tóm tắt ở chỗ khác (dải 4 ô, Q-27). */
  if (railStrip || !rail) {
    return (
      <div className="detail-2col detail-1col">
        <div className="detail-main">
          {railSummary ? <div className="rail-strip">{railSummary}</div> : null}
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="detail-2col">
      <div className="detail-main">{children}</div>
      <aside className="detail-rail">
        {railSummary && narrow ? (
          <details
            className="rail-collapse"
            open={open}
            onToggle={(event) => setOpen(event.currentTarget.open)}
          >
            <summary>
              <span className="rail-summary">{railSummary}</span>
              <span className="rail-more">
                {t('detail.railMore')}
                <Chevron direction={open ? 'up' : 'down'} />
              </span>
            </summary>
            {rail}
          </details>
        ) : (
          rail
        )}
      </aside>
    </div>
  );
}

/** Mốc thu thẻ định danh — khớp `.rail-card` ở detail-tabs.css. */
const RAIL_COLLAPSE_QUERY = BREAKPOINTS.railCollapse;

/**
 * Thẻ định danh. `title` mặc định để mọi trang gọi cùng một tên, khỏi mỗi nơi một kiểu.
 *
 * LÀ MỘT KHU CÓ TÊN, không phải một cái hộp. Tiêu đề dựng bằng `<div class="rail-h">` thì
 * nhìn y hệt, nhưng với trình đọc màn hình nó chỉ là chữ trôi giữa trang: không nhảy tới
 * được, không biết mấy dòng dưới thuộc về nó.
 *
 * Thẻ này lại đang giữ đúng những thứ người ta cần gấp nhất (mã, vị trí, trạng thái, còn bao
 * nhiêu ngày bảo hành/hạn), và hạn CHỈ có ở đây — cột chính không vẽ lại. Một khu quan trọng
 * đến thế mà không có tên thì đường vào duy nhất là nghe hết cả trang.
 */
export function RailCard({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="rail-card" aria-labelledby={id}>
      <h2 className="rail-h" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Một KHU CÓ TÊN ở cột chính — bản anh em của `RailCard` cho nửa bên trái.
 *
 * VÌ SAO CÓ NÓ. Khu "Hồ sơ" có mặt ở bốn trang chi tiết; chép `<section className="card
 * device-panel" aria-labelledby=…>` + `<h2 className="form-section-title">` vào bốn file
 * `features/` là fork bản sao, thứ AD-15 cấm thẳng ("cần khác đi thì thêm prop, CẤM copy ra
 * bản riêng"), và đổi một chi tiết là phải sửa bốn chỗ. `RailCard` ngay trên đây là khuôn mẫu
 * cho cột phải; đây là bản cho cột trái.
 *
 * `useId` thay cho `id="sec-ho-so"` gõ tay: id gõ tay chỉ an toàn chừng nào không màn nào vẽ
 * hai khu cùng lúc — một điều kiện không ai cưỡng chế được, và ngày nó vỡ thì `aria-labelledby`
 * trỏ nhầm trong im lặng.
 *
 * `compact` = dùng cho màn mà các khu ANH EM của nó đã là `device-panel` (hiện chỉ trang chi
 * tiết thiết bị). Ở đó khu này phải bó đúng bằng hàng xóm; ở ba màn còn lại nó đứng một mình
 * trong cột chính, và thứ để mắt so sánh là thẻ định danh bên phải — nên `.card` trần mới là
 * bản khớp. Đừng đặt `compact` "cho đều": nó đang nói một điều CÓ THẬT về màn đang vẽ.
 */
export function DetailSection({
  title,
  children,
  compact,
  action,
  foldable,
  id,
}: {
  title: string;
  children: ReactNode;
  compact?: boolean;
  /** Nút việc của khu ("Bổ sung N ô"), đứng bên phải tiêu đề — không lọt thỏm cuối khu. */
  action?: ReactNode;
  /**
   * Khu ít dùng mà dài (ảnh trên sơ đồ): gập sẵn, dòng tiêu đề nói tóm tắt để biết có cần mở
   * không. Nội dung gập thì gỡ khỏi cây, cùng cách với khu IP/NAT của trang thiết bị.
   */
  foldable?: {
    defaultOpen?: boolean;
    summary?: ReactNode;
    /** Mở / gập do nơi gọi giữ (bấm ô trên bản đồ quan hệ là mở đúng khu) — có thì bỏ `defaultOpen`. */
    open?: boolean;
    onToggle?: () => void;
  };
  /** `id` của khu để nơi khác cuộn tới (`#sec-ipam`); tiêu đề vẫn dùng id tự sinh. */
  id?: string;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const [ownOpen, setOwnOpen] = useState(foldable?.defaultOpen ?? false);
  const open = foldable?.open ?? ownOpen;
  const toggle = foldable?.onToggle ?? (() => setOwnOpen((value) => !value));
  const shown = !foldable || open;
  const head =
    action || foldable ? (
      <div className="form-section-head detail-section-head">
        <h2 className="form-section-title" id={titleId}>
          {title}
        </h2>
        <span className="detail-section-actions">
          {shown ? action : null}
          {foldable ? (
            <button
              type="button"
              className="btn sm ghost"
              aria-expanded={open}
              /* Thân khu bị gỡ khỏi cây khi gập: chỉ trỏ tới nó lúc nó có mặt, không thì IDREF hỏng. */
              aria-controls={open ? bodyId : undefined}
              aria-label={t(open ? 'detail.sectionCollapse' : 'detail.sectionExpand', { title })}
              onClick={toggle}
            >
              <Chevron direction={open ? 'up' : 'down'} />
            </button>
          ) : null}
        </span>
        {/* Tóm tắt xuống hàng riêng dưới tiêu đề: nút gập luôn đứng cùng hàng tiêu đề, ở mọi cỡ màn. */}
        {foldable && !open && foldable.summary ? <span className="muted small detail-section-summary">{foldable.summary}</span> : null}
      </div>
    ) : (
      <h2 className="form-section-title" id={titleId}>
        {title}
      </h2>
    );
  return (
    <section id={id} className={compact ? 'card device-panel' : 'card'} aria-labelledby={titleId}>
      {head}
      {shown ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}
