import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { UserRole } from '@/lib/me';
import { PATHS, canSeeRoute } from '@/lib/routes';

/** Đường tới màn Nhật ký hệ thống đã lọc sẵn một đối tượng. */
function auditLogHref(objectType: string, objectId: string): string {
  const params = new URLSearchParams({ objectType, objectId });
  return `${PATHS.adminAuditLog}?${params.toString()}`;
}

/**
 * Link "Nhật ký thao tác" của một hồ sơ — trả lời "ai đổi IP máy này" mà không phải dò UUID.
 *
 * Tự ẩn với vai không vào được màn Nhật ký: hiện một link dẫn tới trang 403 là mời bấm vào
 * ngõ cụt. Đặt ở tab Lịch sử (lịch sử nghiệp vụ → nhật ký đầy đủ), không đặt ở bộ nút đầu
 * trang.
 */
export function AuditLogLink({
  role,
  objectType,
  objectId,
}: {
  role: UserRole;
  objectType: string;
  objectId: string;
}) {
  const { t } = useTranslation();
  if (!canSeeRoute(PATHS.adminAuditLog, role)) return null;
  return (
    <p className="muted small">
      <Link to={auditLogHref(objectType, objectId)}>{t('history.auditLog')}</Link>
    </p>
  );
}
