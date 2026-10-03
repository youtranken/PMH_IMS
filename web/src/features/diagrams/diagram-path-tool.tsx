import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { DeviceCombobox } from '@/ui/device-combobox';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import type { PathResult } from './diagram-api';

type Pick = { deviceId: string; term: string };

const EMPTY: Pick = { deviceId: '', term: '' };

/**
 * "Chỉ đường" giữa hai máy: chọn A và B (A điền sẵn máy đang chọn trên bản vẽ), server tìm đường
 * ít dây nhất trên SƠ ĐỒ CỔNG (không trên nét vẽ — AD-18). Không có đường thì báo ngay trong hộp;
 * có đường thì hộp đóng và màn tô sáng. Hộp thoại (không phải hộp gọn `Popover`) vì danh sách gợi
 * ý của ô chọn máy nổi ra ngoài — bấm vào đó không được tính là bấm ra ngoài hộp.
 */
export function DiagramPathTool({
  initialFrom,
  onResult,
}: {
  /** Máy đang chọn trên bản vẽ (thẻ thông tin / tìm) — điền sẵn ô "Từ máy". */
  initialFrom: Pick | null;
  onResult: (result: PathResult) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<Pick>(EMPTY);
  const [to, setTo] = useState<Pick>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setFrom(initialFrom ?? EMPTY);
    setTo(EMPTY);
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    if (!from.deviceId || !to.deviceId) return;
    if (from.deviceId === to.deviceId) {
      setError(t('diagrams.nav.pathSame'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<PathResult>(`/api/v1/diagrams/path?${new URLSearchParams({ from: from.deviceId, to: to.deviceId }).toString()}`);
      onResult(result);
      if (result.path) setOpen(false);
      else setError(t('diagrams.nav.pathNone', { from: result.from.code, to: result.to.code }));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn" onClick={start}>
        {t('diagrams.nav.path')}
      </button>
      {open ? (
        <Dialog
          open
          onOpenChange={setOpen}
          dismissible={!busy}
          maxWidth={520}
          title={t('diagrams.nav.pathTitle')}
          footer={
            <>
              <DialogCancel>{t('common.cancel')}</DialogCancel>
              <button type="button" className="btn primary" disabled={busy || !from.deviceId || !to.deviceId} onClick={() => void submit()}>
                {t('diagrams.nav.pathSubmit')}
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
            <Field label={t('diagrams.nav.pathFrom')}>
              <DeviceCombobox
                value={from}
                onChange={(next) => setFrom({ deviceId: next.deviceId, term: next.term })}
                ariaLabel={t('diagrams.nav.pathFrom')}
                placeholder={t('diagrams.nav.pathPick')}
              />
            </Field>
            <Field label={t('diagrams.nav.pathTo')}>
              <DeviceCombobox
                value={to}
                onChange={(next) => setTo({ deviceId: next.deviceId, term: next.term })}
                ariaLabel={t('diagrams.nav.pathTo')}
                placeholder={t('diagrams.nav.pathPick')}
              />
            </Field>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
