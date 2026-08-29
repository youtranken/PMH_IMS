import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorCode, errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime, formatMoney, orDash } from '@/lib/format';
import { Combobox } from '@/ui/combobox';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import type { DeviceRow } from '@/lib/device-types';
import { SeatTerm } from './seat-cells';
import {
  seatLabel,
  supportsSeats,
  type LicenseSeat,
  type SoftwareRow,
} from './software-types';
import { PATHS } from '@/lib/routes';

interface AssignmentRow extends LicenseSeat {
  releasedBy: string | null;
  releasedAt: string | null;
  overSeatReason: string | null;
}

/**
 * Máy đang dùng key (story 3.2, FR-011).
 *
 * Mặc định chỉ hiện bản ghi CÒN HIỆU LỰC; bật "xem cả đã gỡ" mới thấy lịch sử đầy đủ —
 * "key này từng nhập máy nào" là câu hỏi lúc rà license, không được mất, nhưng cũng không
 * nên chen vào danh sách hằng ngày.
 */
export function LicenseAssignmentsPanel({
  software,
  csrfToken,
}: {
  software: SoftwareRow;
  csrfToken: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [showReleased, setShowReleased] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState<AssignmentRow | null>(null);

  const queryKey = ['software', software.id, 'assignments', showReleased];
  const assignments = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<AssignmentRow[]>(
        `/api/v1/software/${software.id}/assignments?includeReleased=${String(showReleased)}`,
      ),
  });

  const release = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/software/${software.id}/assignments/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['software'] });

  if (!supportsSeats(software.kind)) {
    return <p className="muted">{t('license.onlyLicense')}</p>;
  }

  const rows = assignments.data ?? [];

  return (
    <div className="attachment-panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted">
          {t('software.seats')}: <span className="mono">{seatLabel(software)}</span>
        </span>
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <button type="button" className="btn sm" onClick={() => setShowReleased((v) => !v)}>
            {t(showReleased ? 'license.hideReleased' : 'license.showReleased')}
          </button>
          <button type="button" className="btn primary" onClick={() => setAssigning(true)}>
            {t('license.assign')}
          </button>
        </div>
      </div>

      {assignments.isLoading ? (
        <Loading />
      ) : assignments.isError ? (
        <LoadError onRetry={() => void assignments.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('license.empty')} hint={t('license.emptyHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('license.device')}</th>
                <th className="num">{t('license.cost')}</th>
                <th>{t('license.term')}</th>
                <th>{t('license.contract')}</th>
                <th>{t('license.note')}</th>
                <th>{t('license.state')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.releasedAt ? 'row-muted' : undefined}>
                  <td data-label={t('license.device')}>
                    <Link className="mono" to={PATHS.device(row.deviceId)}>
                      {row.deviceCode}
                    </Link>
                    <span className="cell-sub">{row.deviceName}</span>
                  </td>
                  <td className="num" data-label={t('license.cost')}>
                    {formatMoney(row.cost)}
                  </td>
                  <td data-label={t('license.term')}>
                    <SeatTerm seat={row} licenseModel={software.licenseModel} />
                    {/* Gán lúc nào, ai gán — vẫn cần, nhưng là thông tin PHỤ so với kỳ hạn
                        hợp đồng, nên tụt xuống dòng nhỏ thay vì chiếm hẳn một cột. */}
                    <span className="cell-sub">
                      {t('license.assignedAt')} {formatDateTime(row.assignedAt)} · {row.assignedBy}
                    </span>
                  </td>
                  <td data-label={t('license.contract')}>{orDash(row.contract)}</td>
                  <td data-label={t('license.note')}>
                    {orDash(row.note)}
                    {row.overSeatReason ? (
                      <span className="cell-sub">
                        {t('license.overSeatReason')}: {row.overSeatReason}
                      </span>
                    ) : null}
                  </td>
                  <td data-label={t('license.state')}>
                    {row.releasedAt ? (
                      <span className="badge muted">
                        {t('license.released')} {formatDateTime(row.releasedAt)}
                      </span>
                    ) : (
                      <span className="badge ok">{t('license.active')}</span>
                    )}
                  </td>
                  <td>
                    {row.releasedAt ? null : (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setEditing(row)}
                      >
                        {t('common.edit')}
                      </button>
                    )}
                    {row.releasedAt ? null : (
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={release.isPending}
                        onClick={() => {
                          void (async () => {
                            const ok = await askConfirm({
                              message: t('license.confirmRelease', { device: row.deviceCode }),
                              danger: true,
                              confirmLabel: t('license.release'),
                            });
                            if (!ok) return;
                            release.mutate(
                              { id: row.id },
                              {
                                onSuccess: () => {
                                  toast({ message: t('license.releasedDone') });
                                  void refresh();
                                },
                                onError: (error) =>
                                  toast({ message: errorMessage(error), tone: 'error' }),
                              },
                            );
                          })();
                        }}
                      >
                        {t('license.release')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assigning ? (
        <AssignDialog
          software={software}
          csrfToken={csrfToken}
          onClose={() => setAssigning(false)}
          onDone={(warnings) => {
            setAssigning(false);
            toast({ message: t('license.assigned') });
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}

      {editing ? (
        <AssignDialog
          software={software}
          seat={editing}
          csrfToken={csrfToken}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            toast({ message: t('license.seatSaved', { device: editing.deviceCode }) });
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Hộp gán license vào máy — VÀ hộp sửa kỳ hạn/chi phí của một ghế đã gán (0027).
 *
 * Một hộp cho cả hai vì các ô là MỘT BỘ: chi phí, hợp đồng, kỳ hạn riêng, ghi chú. Tách hai
 * hộp thì lần sau thêm một ô sẽ chỉ nhớ thêm vào một bên — và bên còn lại âm thầm ghi thiếu.
 * Khác nhau đúng hai chỗ: có chọn máy hay không, và POST hay PATCH.
 *
 * `export` để khu BUNG DÒNG trên danh sách dùng lại đúng hộp này (AD-15 cấm chép bản thứ hai;
 * hai bản sẽ trôi khác nhau đúng lúc luật vượt seat đổi).
 */
export function AssignDialog({
  software,
  seat,
  csrfToken,
  onClose,
  onDone,
}: {
  software: SoftwareRow;
  /** Có giá trị = SỬA ghế đang có (khóa máy, PATCH). Bỏ trống = gán máy mới. */
  seat?: LicenseSeat;
  csrfToken: string;
  onClose: () => void;
  onDone: (warnings: string[]) => void;
}) {
  const { t } = useTranslation();
  const editing = seat !== undefined;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [device, setDevice] = useState<{ id: string; code: string } | null>(null);
  const [note, setNote] = useState(seat?.note ?? '');
  // Chi phí giữ dạng CHUỖI trong lúc gõ: ô rỗng phải khác được với số 0, mà `number | ''`
  // trong state thì mỗi lần xóa hết ký tự lại nhảy về 0 ngay dưới con trỏ.
  const [cost, setCost] = useState(seat?.cost === null || seat === undefined ? '' : String(seat.cost));
  const [contract, setContract] = useState(seat?.contract ?? '');
  const [startDate, setStartDate] = useState(seat?.startDate ?? '');
  const [endDate, setEndDate] = useState(seat?.endDate ?? '');
  const [overSeatReason, setOverSeatReason] = useState('');
  const [needReason, setNeedReason] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // License mua đứt thì chỗ ngồi của nó cũng không có ngày kết thúc — ô đó không được hiện
  // ra để rồi API trả về lỗi. Luật nằm ở API (`validateAssignmentTerms`), đây chỉ là hệ quả.
  const hasEndDate = software.licenseModel !== 'perpetual';

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const candidates = useQuery({
    queryKey: ['devices', 'picker', debounced],
    enabled: !editing && debounced.trim().length >= 2,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[] }>(
        `/api/v1/devices?limit=10&search=${encodeURIComponent(debounced.trim())}`,
      ),
  });

  const save = useApiMutation<Record<string, unknown>, { warnings?: string[] }>(
    editing
      ? `/api/v1/software/${software.id}/assignments/${seat.id}`
      : `/api/v1/software/${software.id}/assignments`,
    { method: editing ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={640}
      title={
        editing
          ? `${t('license.editSeatTitle')} — ${seat.deviceCode}`
          : `${t('license.assignTitle')} — ${software.code}`
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="assign-form" className="btn primary" disabled={save.isPending}>
            {save.isPending
              ? t('common.loading')
              : editing
                ? t('common.save')
                : t('license.assign')}
          </button>
        </>
      }
    >
      {/* `.form-grid` tự chia cột theo bề rộng (auto-fill 210px): ở hộp 640px là 2 cột.
          Không có thuộc tính `data-columns` nào điều khiển chuyện này — nó từng có mặt ở
          đây nhưng không hề có CSS, đọc vào tưởng chỉnh được. */}
      <form
        id="assign-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!editing && !device) {
            setError(t('license.pickDevice'));
            return;
          }
          const terms = {
            // Chuỗi rỗng = XÓA chi phí đang có, không phải 0đ. Hai chuyện khác nhau.
            cost: cost.trim() === '' ? null : Number(cost.trim()),
            contract: contract.trim(),
            startDate,
            endDate: hasEndDate ? endDate : '',
            note: note.trim(),
          };
          if (terms.cost !== null && !Number.isFinite(terms.cost)) {
            setError(t('license.costInvalid'));
            return;
          }
          save.mutate(
            editing
              ? terms
              : { deviceId: device!.id, overSeatReason: overSeatReason.trim(), ...terms },
            {
              onSuccess: (result) => onDone(result.warnings ?? []),
              onError: (err) => {
                // Hết seat: KHÔNG chặn hẳn — mở ô lý do rồi cho gửi lại (AC 3.2).
                if (errorCode(err) === 'SEAT_LIMIT_REACHED') setNeedReason(true);
                setError(errorMessage(err));
              },
            },
          );
        }}
      >
        <p className="muted span-2">
          {t('software.seats')}: <span className="mono">{seatLabel(software)}</span>
        </p>

        {editing ? (
          <Field label={t('license.device')} span={2}>
            {/* Đổi máy KHÔNG phải là sửa ghế: bản ghi cũ phải được gỡ (giữ lại dấu vết) rồi
                gán bản mới, nếu không thì lịch sử "key này từng nhập máy nào" mất một chặng. */}
            <p className="static-value">
              <span className="mono">{seat.deviceCode}</span> {seat.deviceName}
            </p>
          </Field>
        ) : (
          <Field label={t('license.device')} required hint={t('license.deviceHint')} span={2}>
            <Combobox
              placeholder={t('license.deviceSearch')}
              query={query}
              onQuery={(value) => {
                setQuery(value);
                // Gõ lại là bỏ lựa chọn cũ — nếu không, ô hiện tên A mà id vẫn là B.
                setDevice(null);
              }}
              options={candidates.data?.items ?? []}
              getKey={(item) => item.id}
              renderOption={(item) => (
                <>
                  <span className="mono">{item.code}</span> <small>{item.name}</small>
                </>
              )}
              onSelect={(item) => {
                setDevice({ id: item.id, code: item.code });
                setQuery(item.code);
              }}
            />
          </Field>
        )}

        <Field label={t('license.cost')} hint={t('license.costHint')} htmlFor="assign-cost">
          <input
            id="assign-cost"
            className="inp mono"
            inputMode="numeric"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </Field>
        <Field label={t('license.contract')} hint={t('license.contractHint')} htmlFor="assign-contract">
          <input
            id="assign-contract"
            className="inp"
            value={contract}
            onChange={(e) => setContract(e.target.value)}
          />
        </Field>

        <Field label={t('license.startDate')}>
          <DatePicker
            value={startDate}
            ariaLabel={t('license.startDate')}
            onChange={setStartDate}
          />
        </Field>
        {hasEndDate ? (
          <Field label={t('license.endDate')} hint={t('license.endDateHint')}>
            <DatePicker value={endDate} ariaLabel={t('license.endDate')} onChange={setEndDate} />
          </Field>
        ) : (
          <Field label={t('license.endDate')}>
            <p className="static-value">{t('software.perpetual')}</p>
          </Field>
        )}

        <Field label={t('license.note')} htmlFor="assign-note" span={2}>
          <input
            id="assign-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {needReason ? (
          <Field
            label={t('license.overSeatReason')}
            required
            hint={t('license.overSeatHint')}
            htmlFor="assign-reason"
            span={2}
          >
            <input
              id="assign-reason"
              className="inp"
              value={overSeatReason}
              onChange={(e) => setOverSeatReason(e.target.value)}
            />
          </Field>
        ) : null}

        {error ? (
          <p className="alert error span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
