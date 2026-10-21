import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { activeOptions, siteFormLabel, useCatalogLists } from '@/ui/use-catalog-lists';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import type { VersionItem } from './diagram-api';

/**
 * "Dựng nháp từ sơ đồ cổng" (FR-048): chọn một site hoặc một tủ → server tạo phiên bản nháp MỚI có
 * thiết bị + dây đã gắn kết nối, xếp lưới; trần `diagram.autolayout_max_nodes` do server áp. IMS
 * không viết thuật toán bố cục — người vẽ dùng Arrange → Layout của draw.io.
 */
export function DraftFromPortMapDialog({
  diagramId,
  title,
  dirty,
  csrfToken,
  run,
  onClose,
  onDone,
}: {
  diagramId: string;
  title: string;
  /** Đang có nét chưa lưu: dựng nháp nạp phiên bản mới vào khung, phần chưa lưu mất. */
  dirty: boolean;
  csrfToken: string;
  run: <T>(action: () => Promise<T>, purpose: string) => Promise<T>;
  onClose: () => void;
  onDone: (version: VersionItem) => void;
}) {
  const { t } = useTranslation();
  const lists = useCatalogLists();
  const [by, setBy] = useState<'site' | 'cabinet'>('cabinet');
  const [siteId, setSiteId] = useState('');
  const [cabinetId, setCabinetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = by === 'site' ? siteId : cabinetId;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const version = await run(
        () =>
          apiFetch<VersionItem>(`/api/v1/diagrams/${diagramId}/versions/from-port-map`, {
            method: 'POST',
            csrfToken,
            body: JSON.stringify(by === 'site' ? { siteId } : { cabinetId }),
          }),
        t('diagrams.cable.draftStepUp', { name: title }),
      );
      onDone(version);
    } catch (err) {
      if (!isStepUpCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={560}
      title={t('diagrams.cable.draftTitle')}
      footer={
        <>
          <DialogCancel>{t('common.cancel')}</DialogCancel>
          <button type="button" className="btn primary" disabled={busy || !chosen} onClick={() => void submit()}>
            {t('diagrams.cable.draftSubmit')}
          </button>
        </>
      }
    >
      <div className="form-grid" data-columns={1}>
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="muted">{t('diagrams.cable.draftHint')}</p>
        {dirty ? (
          <p className="alert warn" role="note">
            {t('diagrams.screen.leaveMessage')}
          </p>
        ) : null}
        <div className="segmented fill" role="radiogroup" aria-label={t('diagrams.cable.draftScope')}>
          {(['cabinet', 'site'] as const).map((value) => (
            <label key={value}>
              <input type="radio" name="draft-scope" value={value} checked={by === value} onChange={() => setBy(value)} />
              {t(value === 'site' ? 'diagrams.cable.draftBySite' : 'diagrams.cable.draftByCabinet')}
            </label>
          ))}
        </div>
        {by === 'site' ? (
          <Field label={t('diagrams.cable.draftSite')}>
            <Select
              value={siteId}
              onChange={setSiteId}
              ariaLabel={t('diagrams.cable.draftSite')}
              options={activeOptions(lists.data?.sites, null, (site) => siteFormLabel(site))}
            />
          </Field>
        ) : (
          <Field label={t('diagrams.cable.draftCabinet')}>
            <Select
              value={cabinetId}
              onChange={setCabinetId}
              ariaLabel={t('diagrams.cable.draftCabinet')}
              options={activeOptions(lists.data?.cabinets, null, (row) => `${row.siteCode} · ${row.code}`)}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
