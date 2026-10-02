import { Chevron } from '@/ui/chevron';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { ApiError } from '@/lib/api-client';
import { describeLoadError } from '@/lib/load-error-text';
import type { UserRole } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import { openCommandPalette, paletteShortcut } from '@/ui/command-palette';
import { CopyButton } from '@/ui/copy-button';
import { useAnnounce } from '@/ui/live-region';

/**
 * Hợp đồng loading/empty/error dùng chung: mọi màn fetch phải PHÂN BIỆT "đang tải" ≠ "rỗng" ≠
 * "lỗi". Không phân biệt thì màn nuốt lỗi thành 0 hoặc kẹt "…" vô hạn.
 * (Lượt gọi mạng đi qua `lib/api-client.ts`; file này chỉ export component — fast-refresh.)
 */

/**
 * Empty-state dùng chung: icon + tiêu đề + gợi ý + (tùy) nút hành động. Thay cho
 * `<p className="empty">` khi muốn hướng người dùng bước tiếp (giảm cảm giác "trống trơn").
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span>{title}</span>
      {hint && <span className="empty-hint">{hint}</span>}
      {action && <span className="empty-action">{action}</span>}
    </div>
  );
}

/**
 * Khối hiện thay cho một màn vừa ném lỗi lúc render (`ErrorBoundary`). Không dùng router: nó
 * còn được đặt ở gốc app, ngoài router.
 */
export function ScreenError() {
  const { t } = useTranslation();
  return (
    <div className="error-state" role="alert">
      <h1>{t('app.screenErrorTitle')}</h1>
      <p className="muted">{t('app.screenErrorHint')}</p>
      <div className="error-actions">
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          {t('app.reload')}
        </button>
        <button type="button" onClick={() => window.location.assign('/')}>
          {t('app.backHome')}
        </button>
      </div>
    </div>
  );
}

/**
 * Màn 404 khi vào route không tồn tại (thay cho redirect câm về "/").
 *
 * Nói ĐƯỜNG DẪN vừa mở (người dùng thấy ngay mình gõ sai chỗ nào) và cho ba lối ra: quay lại,
 * về trang chủ, hoặc tìm nhanh. Lối ra là `<Link>`/`<button>` đứng riêng — không lồng nút
 * trong link (Tab dừng hai lần, trình đọc màn hình đọc "link, button").
 */
export function NotFound() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <div className="error-state">
      <div className="error-code">404</div>
      <h1>{t('app.notFoundTitle')}</h1>
      <p className="muted">{t('app.notFoundHint', { path: pathname })}</p>
      <ExitActions />
      <SearchHint />
    </div>
  );
}

const ROLE_LABEL: Record<UserRole, string> = {
  sa: 'accounts.roleSa',
  admin: 'accounts.roleAdmin',
  member: 'accounts.roleMember',
};

/**
 * Trang CÓ tồn tại nhưng vai này không được xem (MISC-001).
 *
 * Trả 404 cho trường hợp này là nói sai: người dùng mở link đồng nghiệp gửi, đọc "trang không
 * tồn tại", rồi đi báo lỗi hệ thống. Sự tồn tại của các màn quản trị không phải bí mật (menu
 * SA có, tài liệu có) — nói thẳng là thiếu quyền và ai được xem. Hàng rào thật vẫn là
 * `@Roles` ở API; màn này chỉ là lời giải thích.
 */
export function Forbidden({ roles }: { roles: readonly UserRole[] }) {
  const { t } = useTranslation();
  return (
    <div className="error-state">
      <div className="error-code">403</div>
      <h1>{t('app.forbiddenTitle')}</h1>
      <p className="muted">
        {t('app.forbiddenHint', { roles: roles.map((role) => t(ROLE_LABEL[role])).join(', ') })}
      </p>
      <ExitActions />
    </div>
  );
}

function ExitActions() {
  const { t } = useTranslation();
  return (
    <div className="error-actions">
      <button type="button" onClick={() => window.history.back()}>
        {t('app.goBack')}
      </button>
      <Link to="/" className="linkbtn primary">
        {t('app.backHome')}
      </Link>
    </div>
  );
}

function SearchHint() {
  const { t } = useTranslation();
  const [keys] = useState(paletteShortcut);
  return (
    <button type="button" className="error-search" onClick={openCommandPalette}>
      {t('app.orSearch', { keys })}
    </button>
  );
}

/**
 * Trang CHI TIẾT không tải được hồ sơ (MISC-007): vẫn giữ đường lùi về danh sách ở đúng chỗ
 * breadcrumb thường nằm, và tách "hồ sơ không còn" (404 — nói câu dữ liệu, nút về danh sách)
 * khỏi "máy chủ lỗi" (khối lỗi có Thử lại). Mất cả hai thì người dùng chỉ còn cách bấm sidebar.
 */
export function DetailLoadFailed({
  error,
  onRetry,
  backTo,
  backLabel,
}: {
  error: unknown;
  onRetry: () => void;
  backTo: string;
  backLabel: string;
}) {
  const { t } = useTranslation();
  const missing = error instanceof ApiError && error.status === 404;
  return (
    <>
      <nav className="crumbs" aria-label="breadcrumb">
        <span className="crumb">
          <Link className="crumb-back" to={backTo}>
            <Chevron direction="left" className="crumb-arrow" />
            {backLabel}
          </Link>
        </span>
      </nav>
      {missing ? (
        <div className="error-state">
          <div className="error-code">404</div>
          <h1>{t('app.recordNotFoundTitle')}</h1>
          <p className="muted">{t('app.notFoundData')}</p>
          <div className="error-actions">
            <Link to={backTo} className="linkbtn primary">
              {t('app.backToList', { list: backLabel })}
            </Link>
          </div>
        </div>
      ) : (
        <LoadError error={error} onRetry={onRetry} />
      )}
    </>
  );
}

/**
 * Khối "đang tải" dùng chung — phân biệt với rỗng/lỗi.
 *
 * ===== KHÔNG ĐẶT `role="status"` LÊN NODE NÀY =====
 *
 * Đặt ở đây thì nó KHÔNG BAO GIỜ được đọc lên: node và nội dung của nó sinh ra cùng một lượt,
 * mà trình đọc màn hình chỉ theo dõi những vùng sống đã có mặt TRƯỚC đó. Mọi chỗ "đang tải"
 * trên toàn web sẽ câm — người dùng bấm một nút, nội dung biến mất, và không nghe thấy gì cho
 * tới khi dữ liệu về.
 *
 * Nên lời loan báo đi qua `useAnnounce` tới một vùng sống thường trực gắn ở shell
 * (`ui/live-region.tsx`), không vá tại chỗ từng màn.
 *
 * `aria-busy` GIỮ LẠI trên node này: nó nói về chính vùng đang bận, không phải một lời loan báo.
 */
export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  const text = label ?? t('app.loading');
  useAnnounce(text);
  return (
    <div className="load-state" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{text}</span>
    </div>
  );
}

/**
 * Khối "không tải được + Thử lại" dùng chung khi một màn fetch thất bại.
 *
 * `error` là BẮT BUỘC, cố ý. Nó vốn là prop tùy chọn trong đầu — và tùy chọn nghĩa là 38 chỗ
 * gọi sẽ cứ thế bỏ qua, y như chúng đã bỏ qua suốt từ đầu dự án. Bắt buộc thì mỗi chỗ gọi mới
 * là một lỗi biên dịch cho tới khi có người nối cái lỗi thật vào. Truyền `undefined` vẫn được
 * (nhánh hỏng tự dựng, bài kiểm) nhưng phải VIẾT RA, tức là một quyết định chứ không phải
 * một chỗ quên.
 *
 * Bảng nguyên nhân → câu chữ nằm ở `lib/load-error-text.ts` (hàm thuần, có bài kiểm riêng).
 *
 * `role="alert"`: khối này thay chỗ nội dung vừa biến mất, nên trình đọc màn hình phải nghe
 * được ngay — chờ người dùng tự tab tới thì họ chỉ nghe thấy một trang trống.
 */
export function LoadError({ onRetry, error }: { onRetry: () => void; error: unknown }) {
  const { t } = useTranslation();
  const described = describeLoadError(error);
  // `window.location`, không `useLocation`: khối này còn được dựng ngoài router (lỗi `/auth/me`).
  const { pathname } = window.location;
  // Mốc giờ của LƯỢT HỎNG NÀY — chụp một lần, không trôi theo mỗi lượt render.
  const [at] = useState(() => new Date().toISOString());
  const status = error instanceof ApiError ? String(error.status) : t('app.techNoResponse');
  const tech = [
    t('app.techStatus', { status }),
    t('app.techTime', { time: formatDateTime(at) }),
    t('app.techPath', { path: pathname }),
  ].join(' · ');
  /*
   * Khối có khung + icon, nút Thử lại cỡ thường (không phải nút chính thu nhỏ), và phần "Chi
   * tiết kỹ thuật" để người dùng gửi đúng thứ người sửa cần. Một chỗ dùng chung, mọi màn cùng hưởng.
   */
  return (
    <div className="load-error" role="alert">
      <span className="load-error-ic" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3 2 20h20L12 3z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
      </span>
      <div className="load-error-body">
        <p className="load-error-text">{described.text ?? t(described.key)}</p>
        <div className="load-error-actions">
          <button type="button" onClick={onRetry}>
            {t('app.retry')}
          </button>
        </div>
        <details className="load-error-tech">
          <summary>{t('app.techDetails')}</summary>
          <p>
            <span className="mono">{tech}</span> <CopyButton value={tech} label={t('app.techCopy')} />
          </p>
        </details>
      </div>
    </div>
  );
}
