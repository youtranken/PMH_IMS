import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';

/** Một nhóm thứ máy đang giữ, đọc từ chính `/panels` + `/ports` — không đoán. */
export interface RetireGroup {
  title: string;
  items: string[];
}

/**
 * Hộp Thanh lý: nói rõ SẼ GỠ gì và GIỮ NGUYÊN gì TRƯỚC khi bấm, bằng dữ liệu thật của máy.
 *
 * Không dùng `ConfirmDialog`: hộp đó cố ý chỉ nhận một câu + một ô tick. Ở đây có hai danh
 * sách, một lựa chọn hai nhánh và một ô gõ lại mã — là một form nhỏ, nên dựng trên `Dialog`.
 *
 * Mặc định là "Chỉ thanh lý": gỡ hàng loạt (thu hồi IP, gỡ rule NAT, trả ghế license) không
 * hoàn tác được nên phải là điều người dùng chọn ra. Chọn gỡ mà có mục bị gỡ thì bắt gõ lại mã
 * máy — một cú bấm theo quán tính không được xoá sạch IP của một máy đang chạy.
 */
export function RetireDialog({
  code,
  cut,
  keep,
  unknown,
  blockedBy,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  code: string;
  /** Nhóm sẽ bị gỡ khi chọn "Gỡ hết". Rỗng = máy không giữ gì phải gỡ. */
  cut: RetireGroup[];
  /** Thứ giữ nguyên (cổng của chính máy, két, giấy tờ, lịch sử). */
  keep: string[];
  /** Chưa đọc được sổ khu mở rộng / cổng — danh sách có thể thiếu. */
  unknown: boolean;
  /** Danh sách API trả kèm 409 `DEVICE_HAS_HOLDINGS` — nguồn đúng nhất, thắng `cut`. */
  blockedBy: string[] | null;
  busy: boolean;
  error: string | null;
  onConfirm: (cleanup: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [cleanup, setCleanup] = useState(false);
  const [typed, setTyped] = useState('');
  const typedId = useId();
  const hintId = useId();

  const cutCount = cut.reduce((sum, group) => sum + group.items.length, 0);
  const hasCut = cutCount > 0 || (blockedBy?.length ?? 0) > 0 || unknown;
  // Chưa đọc được thì coi như CÓ mục bị gỡ: đòi gõ mã là phía an toàn.
  const needsCode = cleanup && hasCut;
  const codeOk = typed.trim().toUpperCase() === code.toUpperCase();
  const canSubmit = !busy && (!needsCode || codeOk);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
      dismissible={!busy}
      maxWidth={560}
      title={t('common.titleOf', { action: t('devices.retire'), subject: code })}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={!canSubmit}
            onClick={() => onConfirm(cleanup)}
          >
            {busy ? t('common.working') : t('devices.retire')}
          </button>
        </>
      }
    >
      <div className="retire-dialog">
        {error ? (
          <p role="alert" className="alert error">
            {error}
          </p>
        ) : null}
        <p>{t('devices.retireIntro')}</p>

        {blockedBy && blockedBy.length > 0 ? (
          <section className="retire-block retire-cut" aria-labelledby={`${hintId}-blocked`}>
            <h3 id={`${hintId}-blocked`}>{t('devices.retireBlocked')}</h3>
            <ul>
              {blockedBy.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="retire-block retire-cut" aria-labelledby={`${hintId}-cut`}>
            <h3 id={`${hintId}-cut`}>{t('devices.retireWillCut')}</h3>
            {unknown ? (
              <p className="retire-warn">{t('relationMap.cutUnknown')}</p>
            ) : cutCount === 0 ? (
              <p className="muted">{t('devices.retireNothingToCut')}</p>
            ) : (
              <ul>
                {cut
                  .filter((group) => group.items.length > 0)
                  .map((group) => (
                    <li key={group.title}>
                      <b>{group.title}</b>
                      <ul>
                        {group.items.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        )}

        <section className="retire-block" aria-labelledby={`${hintId}-keep`}>
          <h3 id={`${hintId}-keep`}>{t('devices.retireWillKeep')}</h3>
          <ul>
            {keep.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>

        {hasCut ? (
          <fieldset className="retire-mode">
            <legend>{t('devices.retireModeLabel')}</legend>
            <label className="confirm-check">
              <input
                type="radio"
                name="retire-mode"
                checked={!cleanup}
                disabled={busy}
                onChange={() => setCleanup(false)}
              />
              <span>{t('devices.retireModeOnly')}</span>
            </label>
            <label className="confirm-check">
              <input
                type="radio"
                name="retire-mode"
                checked={cleanup}
                disabled={busy}
                aria-describedby={hintId}
                onChange={() => setCleanup(true)}
              />
              <span>{t('devices.retireModeCleanup')}</span>
            </label>
            <p id={hintId} className="confirm-check-hint">
              {t('devices.retireCleanupHint')}
            </p>
          </fieldset>
        ) : null}

        {needsCode ? (
          <Field
            label={t('devices.retireTypeCode', { code })}
            htmlFor={typedId}
            error={typed.trim().length > 0 && !codeOk ? t('devices.retireTypeCodeMismatch') : null}
          >
            <input
              className="mono"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              disabled={busy}
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
