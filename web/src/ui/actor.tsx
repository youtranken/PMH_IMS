import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

/**
 * Người thao tác hiện MỘT kiểu ở mọi chỗ (TX-20 / PW-A13): họ tên, email vào tooltip; tài khoản
 * đã xoá / chưa tra được tên thì hiện email; việc hệ thống tự làm (job hạn, tự thanh lý) là
 * "Hệ thống" chứ không phải chữ `system` của cột audit.
 */
export function actorLabel(
  actor: string,
  actorName: string | null | undefined,
  t: TFunction,
): { text: string; title: string | undefined } {
  if (actor === 'system') return { text: t('common.actorSystem'), title: undefined };
  if (actorName) return { text: actorName, title: actor };
  return { text: actor, title: undefined };
}

export function Actor({ actor, actorName }: { actor: string; actorName?: string | null }) {
  const { t } = useTranslation();
  const label = actorLabel(actor, actorName, t);
  return <span title={label.title}>{label.text}</span>;
}
