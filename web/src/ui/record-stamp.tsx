import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/format';
import { actorLabel } from '@/ui/actor';

/**
 * "Tạo dd/mm/yyyy · sửa lần cuối dd/mm/yyyy bởi X" ở MỌI trang chi tiết (UX-E26): hồ sơ cũ hay
 * mới, ai đụng gần nhất — người đọc cần biết trước khi tin số liệu. `last` là dòng lịch sử mới
 * nhất (API trả mới trước). Có `onOpenHistory` thì phần "sửa lần cuối" mở tab Lịch sử.
 */
export function RecordStamp({
  createdAt,
  last,
  onOpenHistory,
}: {
  createdAt: string;
  last?: { createdAt: string; actor: string; actorName?: string | null };
  onOpenHistory?: () => void;
}) {
  const { t } = useTranslation();
  const lastText = last
    ? t('common.lastEditBy', { date: formatDate(last.createdAt), actor: actorLabel(last.actor, last.actorName, t).text })
    : null;
  const title = last ? actorLabel(last.actor, last.actorName, t).title : undefined;
  return (
    <p className="rail-foot record-stamp">
      {t('common.createdAt', { date: formatDate(createdAt) })}
      {lastText ? (
        <>
          {' · '}
          {onOpenHistory ? (
            <button type="button" className="record-stamp-link" title={title} onClick={onOpenHistory}>
              {lastText}
            </button>
          ) : (
            <span title={title}>{lastText}</span>
          )}
        </>
      ) : null}
    </p>
  );
}
