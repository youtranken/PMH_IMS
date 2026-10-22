import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorCode, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { foldSearch } from '@/lib/search-fold';
import type { Me } from '@/lib/me';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { StickyActionBar } from '@/ui/sticky-action-bar';
import { isStepUpCancelled, useStepUpRetry } from '@/ui/use-step-up-retry';
import { useToast } from '@/ui/toast';
import { useUnsavedGuard } from '@/ui/use-unsaved-guard';
import { checkDraft, descriptionSlot, toDraft, warningOf, type SettingRow } from './settings-rules';

type Group = SettingRow['group'];
/** Đích của một lượt rời nhóm đang dở: sang nhóm khác trên trang, hoặc sang màn khác (router giữ đích). */
type Leave = { group: Group } | 'route';

const GROUPS: { key: Group; label: string }[] = [
  { key: 'auth', label: 'settings.groupAuth' },
  { key: 'vault', label: 'settings.groupVault' },
  { key: 'approval', label: 'settings.groupApproval' },
  { key: 'expiry', label: 'settings.groupExpiry' },
  { key: 'dashboard', label: 'settings.groupDashboard' },
  { key: 'software', label: 'settings.groupSoftware' },
  { key: 'ipam', label: 'settings.groupIpam' },
  { key: 'files', label: 'settings.groupFiles' },
  { key: 'diagram', label: 'settings.groupDiagram' },
  { key: 'devices', label: 'settings.groupDevices' },
  { key: 'iso', label: 'settings.groupIso' },
];

const UNIT: Record<NonNullable<SettingRow['unit']>, string> = {
  seconds: 'settings.unitSeconds',
  minutes: 'settings.unitMinutes',
  hours: 'settings.unitHours',
  days: 'settings.unitDays',
  percent: 'settings.unitPercent',
  times: 'settings.unitTimes',
  per_minute: 'settings.unitPerMinute',
  ports: 'settings.unitPorts',
  rows: 'settings.unitRows',
  mb: 'settings.unitMb',
  kb: 'settings.unitKb',
  files: 'settings.unitFiles',
  cells: 'settings.unitCells',
  devices: 'settings.unitDevices',
  megapixels: 'settings.unitMegapixels',
  hops: 'settings.unitHops',
  px: 'settings.unitPx',
};

/*
 * Nhãn + mô tả từng khoá. Viết thẳng từng khoá (không ghép chuỗi) để bài "khoá dịch chết" đọc
 * được; khoá API trả về mà không có ở đây thì màn hiện chính mã khoá — vẫn sửa được, chỉ xấu.
 */
const TEXT: Record<string, [string, string]> = {
  sessionIdleMinutes: ['settings.sessionIdleMinutesLabel', 'settings.sessionIdleMinutesDesc'],
  sessionAbsoluteHours: ['settings.sessionAbsoluteHoursLabel', 'settings.sessionAbsoluteHoursDesc'],
  loginMaxFailedAttempts: ['settings.loginMaxFailedAttemptsLabel', 'settings.loginMaxFailedAttemptsDesc'],
  loginLockoutMinutes: ['settings.loginLockoutMinutesLabel', 'settings.loginLockoutMinutesDesc'],
  loginRateLimitPerIp: ['settings.loginRateLimitPerIpLabel', 'settings.loginRateLimitPerIpDesc'],
  rateTotpPerMinute: ['settings.rateTotpPerMinuteLabel', 'settings.rateTotpPerMinuteDesc'],
  rateFileUploadPerMinute: ['settings.rateFileUploadPerMinuteLabel', 'settings.rateFileUploadPerMinuteDesc'],
  rateSecretRevealPerMinute: [
    'settings.rateSecretRevealPerMinuteLabel',
    'settings.rateSecretRevealPerMinuteDesc',
  ],
  loginAccountBackoffMinutes: [
    'settings.loginAccountBackoffMinutesLabel',
    'settings.loginAccountBackoffMinutesDesc',
  ],
  totpEnrollReauthMinutes: ['settings.totpEnrollReauthMinutesLabel', 'settings.totpEnrollReauthMinutesDesc'],
  authTotpChallengeMinutes: ['settings.authTotpChallengeMinutesLabel', 'settings.authTotpChallengeMinutesDesc'],
  authTempPasswordHours: ['settings.authTempPasswordHoursLabel', 'settings.authTempPasswordHoursDesc'],
  authSupportContact: ['settings.authSupportContactLabel', 'settings.authSupportContactDesc'],
  secretRevealSeconds: ['settings.secretRevealSecondsLabel', 'settings.secretRevealSecondsDesc'],
  secretStepUpGraceMinutes: ['settings.secretStepUpGraceMinutesLabel', 'settings.secretStepUpGraceMinutesDesc'],
  diagramStepUpGraceMinutes: ['settings.diagramStepUpGraceMinutesLabel', 'settings.diagramStepUpGraceMinutesDesc'],
  secretStepUpMaxFailures: ['settings.secretStepUpMaxFailuresLabel', 'settings.secretStepUpMaxFailuresDesc'],
  secretProbeAlertThreshold: [
    'settings.secretProbeAlertThresholdLabel',
    'settings.secretProbeAlertThresholdDesc',
  ],
  secretProbeWindowMinutes: ['settings.secretProbeWindowMinutesLabel', 'settings.secretProbeWindowMinutesDesc'],
  secretProbeCooldownMinutes: [
    'settings.secretProbeCooldownMinutesLabel',
    'settings.secretProbeCooldownMinutesDesc',
  ],
  secretProbeEscalationMultiplier: [
    'settings.secretProbeEscalationMultiplierLabel',
    'settings.secretProbeEscalationMultiplierDesc',
  ],
  breakGlassMaxGrantHours: ['settings.breakGlassMaxGrantHoursLabel', 'settings.breakGlassMaxGrantHoursDesc'],
  approvalReminderHours: ['settings.approvalReminderHoursLabel', 'settings.approvalReminderHoursDesc'],
  breakGlassPendingExpireHours: [
    'settings.breakGlassPendingExpireHoursLabel',
    'settings.breakGlassPendingExpireHoursDesc',
  ],
  expiryCriticalDays: ['settings.expiryCriticalDaysLabel', 'settings.expiryCriticalDaysDesc'],
  expiryWarningDays: ['settings.expiryWarningDaysLabel', 'settings.expiryWarningDaysDesc'],
  expiryDigestExpiredDays: ['settings.expiryDigestExpiredDaysLabel', 'settings.expiryDigestExpiredDaysDesc'],
  dashboardSubnetFullPercent: [
    'settings.dashboardSubnetFullPercentLabel',
    'settings.dashboardSubnetFullPercentDesc',
  ],
  dashboardSecretStaleDays: ['settings.dashboardSecretStaleDaysLabel', 'settings.dashboardSecretStaleDaysDesc'],
  softwareAutoRetireGraceDays: [
    'settings.softwareAutoRetireGraceDaysLabel',
    'settings.softwareAutoRetireGraceDaysDesc',
  ],
  expiryLookBackDays: ['settings.expiryLookBackDaysLabel', 'settings.expiryLookBackDaysDesc'],
  dashboardMaxItems: ['settings.dashboardMaxItemsLabel', 'settings.dashboardMaxItemsDesc'],
  ipamSubnetMinPrefix: ['settings.ipamSubnetMinPrefixLabel', 'settings.ipamSubnetMinPrefixDesc'],
  natWidePortRange: ['settings.natWidePortRangeLabel', 'settings.natWidePortRangeDesc'],
  natSensitivePorts: ['settings.natSensitivePortsLabel', 'settings.natSensitivePortsDesc'],
  breakGlassRecentWindowDays: ['settings.breakGlassRecentWindowDaysLabel', 'settings.breakGlassRecentWindowDaysDesc'],
  fileMaxSizeMb: ['settings.fileMaxSizeMbLabel', 'settings.fileMaxSizeMbDesc'],
  fileMaxImageMegapixels: ['settings.fileMaxImageMegapixelsLabel', 'settings.fileMaxImageMegapixelsDesc'],
  fileMaxFilesPerBatch: ['settings.fileMaxFilesPerBatchLabel', 'settings.fileMaxFilesPerBatchDesc'],
  filePurgeAfterDays: ['settings.filePurgeAfterDaysLabel', 'settings.filePurgeAfterDaysDesc'],
  diagramEditorInitTimeoutSeconds: [
    'settings.diagramEditorInitTimeoutSecondsLabel',
    'settings.diagramEditorInitTimeoutSecondsDesc',
  ],
  diagramXmlMaxKb: ['settings.diagramXmlMaxKbLabel', 'settings.diagramXmlMaxKbDesc'],
  diagramSvgMaxKb: ['settings.diagramSvgMaxKbLabel', 'settings.diagramSvgMaxKbDesc'],
  diagramMaxCells: ['settings.diagramMaxCellsLabel', 'settings.diagramMaxCellsDesc'],
  diagramPresenceTtlSeconds: ['settings.diagramPresenceTtlSecondsLabel', 'settings.diagramPresenceTtlSecondsDesc'],
  diagramIconSvgMaxKb: ['settings.diagramIconSvgMaxKbLabel', 'settings.diagramIconSvgMaxKbDesc'],
  diagramAutolayoutMaxNodes: ['settings.diagramAutolayoutMaxNodesLabel', 'settings.diagramAutolayoutMaxNodesDesc'],
  diagramExportMaxMegapixels: ['settings.diagramExportMaxMegapixelsLabel', 'settings.diagramExportMaxMegapixelsDesc'],
  diagramExportTimeoutSeconds: ['settings.diagramExportTimeoutSecondsLabel', 'settings.diagramExportTimeoutSecondsDesc'],
  diagramDriftNotifyEnabled: ['settings.diagramDriftNotifyEnabledLabel', 'settings.diagramDriftNotifyEnabledDesc'],
  diagramDriftSweepHour: ['settings.diagramDriftSweepHourLabel', 'settings.diagramDriftSweepHourDesc'],
  diagramPathMaxHops: ['settings.diagramPathMaxHopsLabel', 'settings.diagramPathMaxHopsDesc'],
  diagramPhotoMaxPx: ['settings.diagramPhotoMaxPxLabel', 'settings.diagramPhotoMaxPxDesc'],
  diagramDeviceWidthPx: ['settings.diagramDeviceWidthPxLabel', 'settings.diagramDeviceWidthPxDesc'],
  devicePortTemplateMax: ['settings.devicePortTemplateMaxLabel', 'settings.devicePortTemplateMaxDesc'],
  isoFirstMonth: ['settings.isoFirstMonthLabel', 'settings.isoFirstMonthDesc'],
  isoBackupSystem: ['settings.isoBackupSystemLabel', 'settings.isoBackupSystemDesc'],
  isoAntivirusSystem: ['settings.isoAntivirusSystemLabel', 'settings.isoAntivirusSystemDesc'],
  isoScanMaxMb: ['settings.isoScanMaxMbLabel', 'settings.isoScanMaxMbDesc'],
  isoScanTypes: ['settings.isoScanTypesLabel', 'settings.isoScanTypesDesc'],
  isoRemindHour: ['settings.isoRemindHourLabel', 'settings.isoRemindHourDesc'],
  isoRemindBackupAfterDays: ['settings.isoRemindBackupAfterDaysLabel', 'settings.isoRemindBackupAfterDaysDesc'],
  isoRemindSubmitRepeatDays: ['settings.isoRemindSubmitRepeatDaysLabel', 'settings.isoRemindSubmitRepeatDaysDesc'],
  isoRemindApprovalDays: ['settings.isoRemindApprovalDaysLabel', 'settings.isoRemindApprovalDaysDesc'],
  isoRemindSignedDays: ['settings.isoRemindSignedDaysLabel', 'settings.isoRemindSignedDaysDesc'],
  isoRemindInProgressDays: ['settings.isoRemindInProgressDaysLabel', 'settings.isoRemindInProgressDaysDesc'],
};

const SETTINGS_KEY = ['admin', 'settings'] as const;

/**
 * Tham số hệ thống (Q-14) — chỉ SA. Thay cho việc SSH vào prod gõ `UPDATE system_config`.
 *
 * Lưu THEO NHÓM: đổi vài ô trong nhóm, bấm Lưu → hộp "Trước → Sau" để đọc lại → xác thực lại
 * (step-up) → ghi. Giá trị nguy hiểm (nới rate limit quá rộng, 0 = tắt cảnh báo) có cảnh báo vàng
 * ngay cạnh ô và trong hộp xác nhận — không chặn, vì đôi khi đó đúng là điều SA muốn.
 */
export function SettingsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const stepUp = useStepUpRetry(me.csrfToken);
  const [params, setParams] = useSearchParams();
  const group = (GROUPS.find((g) => g.key === params.get('group'))?.key ?? 'auth') as Group;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Nhóm người dùng bấm sang khi còn thay đổi chưa lưu: hỏi trước (Q-21), lưu xong mới sang. */
  const [leavingTo, setLeavingTo] = useState<Group | null>(null);
  const [saveThenGo, setSaveThenGo] = useState<Leave | null>(null);

  const list = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<SettingRow[]>('/api/v1/admin/settings'),
  });

  /* Ô tìm (UX-E21): ~60 tham số / 11 nhóm — gõ là tìm trên MỌI nhóm theo nhãn, mô tả, khóa (không
     dấu); ô trống thì về nhóm đang chọn. Không lên URL: chỉ là lối tắt trong một lượt sửa. */
  const [q, setQ] = useState('');
  const needle = foldSearch(q.trim());
  const rows = useMemo(
    () =>
      (list.data ?? []).filter((row) =>
        needle
          ? [TEXT[row.name] ? t(TEXT[row.name][0]) : '', TEXT[row.name] ? t(TEXT[row.name][1]) : '', row.key].some((text) =>
              foldSearch(text).includes(needle),
            )
          : row.group === group,
      ),
    [list.data, group, needle, t],
  );
  /* Số tham số đang khác mặc định của từng nhóm — menu nói nhóm nào đã có người chỉnh. */
  const customised = (key: Group) =>
    (list.data ?? []).filter((row) => row.group === key && toDraft(row.value) !== toDraft(row.defaultValue)).length;
  const draftOf = (row: SettingRow) => drafts[row.key] ?? toDraft(row.value);
  /* Trên MỌI tham số, không chỉ phần đang hiện: sửa xong rồi gõ tìm thì thanh Lưu vẫn còn. */
  const all = list.data ?? [];
  const changed = all.filter((row) => draftOf(row).trim() !== toDraft(row.value));
  const checks = new Map(all.map((row) => [row.key, checkDraft(row, draftOf(row))]));
  const invalid = changed.some((row) => checks.get(row.key)?.reason);

  const labelOf = (row: SettingRow) => (TEXT[row.name] ? t(TEXT[row.name][0]) : row.key);
  const withUnit = (row: SettingRow, value: unknown) =>
    value === '' || value === null || value === undefined
      ? t('settings.blank')
      : row.unit
        ? `${String(value)} ${t(UNIT[row.unit])}`
        : String(value);

  /* Rời màn (menu, Ctrl+K, nút lùi) khi còn thay đổi: router giữ lượt đi lại, màn hỏi bằng
     cùng hộp như khi đổi nhóm. Đóng / tải lại tab thì trình duyệt hỏi bằng hộp của nó. */
  const guard = useUnsavedGuard(changed.length > 0);
  /* Router vẫn giữ lượt rời màn trong lúc hộp Trước → Sau mở; khi đó không hỏi chồng lần nữa. */
  const asking: Leave | null = reviewing ? null : leavingTo ? { group: leavingTo } : guard.blocked ? 'route' : null;

  const stay = () => {
    setLeavingTo(null);
    if (guard.blocked) guard.stay();
  };

  const leave = (to: Leave) => {
    if (to === 'route') {
      setDrafts({});
      guard.proceed();
    } else {
      switchGroup(to.group);
    }
  };

  const askSwitch = (next: Group) => {
    // Bấm đúng nhóm đang mở khi đang tìm = thoát ô tìm, về nhóm đó.
    if (next === group) {
      setQ('');
      return;
    }
    if (changed.length > 0) setLeavingTo(next);
    else switchGroup(next);
  };

  const switchGroup = (next: Group) => {
    // Bỏ ô tìm chỉ khi THẬT SỰ sang nhóm khác: chọn "Ở lại" ở hộp hỏi thì vẫn giữ kết quả tìm.
    setQ('');
    setDrafts({});
    setSaveError(null);
    setParams(
      (current) => {
        const out = new URLSearchParams(current);
        out.set('group', next);
        return out;
      },
      { replace: true },
    );
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        changes: changed.map((row) => ({ key: row.key, value: checks.get(row.key)?.value })),
      };
      const next = await stepUp.run(
        () =>
          apiFetch<SettingRow[]>('/api/v1/admin/settings', {
            method: 'PATCH',
            csrfToken: me.csrfToken,
            body: JSON.stringify(body),
          }),
        t('settings.stepUpSave'),
      );
      queryClient.setQueryData(SETTINGS_KEY, next);
      toast({ message: t('settings.saved', { count: changed.length }) });
      setDrafts({});
      setReviewing(false);
      if (saveThenGo) leave(saveThenGo);
      setSaveThenGo(null);
    } catch (err) {
      if (!isStepUpCancelled(err)) {
        /* API báo lỗi khoảng dạng "<khóa>: <lý do>"; người đọc chỉ thấy nhãn tiếng Việt của ô,
           không thấy khóa thô. */
        const message = errorMessage(err);
        const hit =
          errorCode(err) === 'SETTING_OUT_OF_RANGE'
            ? (list.data ?? []).find((row) => message.startsWith(`${row.key}: `))
            : undefined;
        setSaveError(hit ? `${labelOf(hit)}: ${message.slice(hit.key.length + 2)}` : message);
      }
    } finally {
      setSaving(false);
    }
  };

  /* Huỷ ở hộp Trước → Sau khi đang lưu-để-rời-màn = ở lại: trả lượt rời màn router đang giữ. */
  const cancelReview = () => {
    setReviewing(false);
    if (saveThenGo === 'route') guard.stay();
    setSaveThenGo(null);
  };

  return (
    <>
      <PageHeader title={t('settings.title')} />
      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="settings-layout">
          <nav aria-label={t('settings.groupsNav')} className="settings-nav">
            <FilterBar search={q} onSearchChange={setQ} searchPlaceholder={t('settings.search')} />
            <ul>
              {GROUPS.map((g) => (
                <li key={g.key}>
                  <button
                    type="button"
                    /* Đổi khu ngay trên trang, không sang trang khác: nút bật/tắt, không
                       `aria-current="page"` (giá trị đó dành cho link điều hướng). */
                    aria-pressed={!needle && g.key === group}
                    onClick={() => askSwitch(g.key)}
                  >
                    {t(g.label)}
                    {customised(g.key) > 0 ? <span className="seg-count">{customised(g.key)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section className="card settings-panel" aria-labelledby="settings-group-title">
            <h2 id="settings-group-title">
              {needle ? t('settings.searchTitle', { q: q.trim() }) : t(GROUPS.find((g) => g.key === group)?.label ?? '')}
            </h2>
            {needle && rows.length === 0 ? <p className="muted">{t('settings.searchNone')}</p> : null}
            {rows.map((row) => {
              const id = `setting-${row.key.replace(/\W/g, '-')}`;
              const check = checks.get(row.key) ?? checkDraft(row, draftOf(row));
              const dirty = draftOf(row).trim() !== toDraft(row.value);
              const warn = dirty ? warningOf(row, check.value) : null;
              const description = descriptionSlot(
                TEXT[row.name] ? t(TEXT[row.name][1]) : undefined,
                row.name,
              );
              return (
                <div key={row.key} className="settings-row">
                  <Field
                    label={labelOf(row)}
                    htmlFor={id}
                    hint={description.hint}
                    tip={description.tip}
                    error={dirty && check.reason ? t(check.reason.key, check.reason.params) : null}
                  >
                    {row.type === 'text' ? (
                      <textarea
                        id={id}
                        className="inp"
                        rows={2}
                        value={draftOf(row)}
                        maxLength={row.maxLength}
                        onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                      />
                    ) : (
                      <span className="settings-input">
                        <input
                          id={id}
                          className="inp"
                          inputMode={row.type === 'int' ? 'numeric' : 'text'}
                          value={draftOf(row)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                        />
                        {row.unit ? <span className="muted">{t(UNIT[row.unit])}</span> : null}
                      </span>
                    )}
                  </Field>
                  {warn ? (
                    <p className="alert warn" role="status">
                      {t(warn.key, warn.params)}
                    </p>
                  ) : null}
                  {/* Chỉ nói khi có chuyện để nói (TX-41): mỗi tham số lặp "Mặc định: X · Chưa sửa từ
                      lúc cài đặt" là 40 dòng nhiễu trên một trang. */}
                  {row.updatedBy && row.updatedAt ? (
                    <p className="muted settings-meta">
                      {t('settings.lastEdited', { who: row.updatedBy, at: formatDateTime(row.updatedAt) })}
                      {toDraft(row.value) !== toDraft(row.defaultValue)
                        ? ` · ${t('settings.defaultIs', { value: withUnit(row, row.defaultValue) })}`
                        : null}
                    </p>
                  ) : null}
                  {draftOf(row).trim() !== toDraft(row.defaultValue) ? (
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`${t('settings.resetDefault')} — ${labelOf(row)}`}
                      onClick={() => setDrafts((d) => ({ ...d, [row.key]: toDraft(row.defaultValue) }))}
                    >
                      {t('settings.resetDefault')}
                    </button>
                  ) : null}
                </div>
              );
            })}

            <StickyActionBar
              compact
              label={t('settings.save')}
              /* Luôn có một câu bên trái: thanh trống nửa trái trông như hỏng; "chưa có thay đổi" cũng
                 giải thích vì sao hai nút đang tắt. */
              note={changed.length > 0 ? t('settings.dirty', { count: changed.length }) : t('settings.clean')}
            >
              <button
                type="button"
                className="btn sm"
                disabled={changed.length === 0}
                onClick={() => setDrafts({})}
              >
                {t('settings.discard')}
              </button>
              <button
                type="button"
                className="btn sm primary"
                disabled={changed.length === 0 || invalid}
                onClick={() => {
                  setSaveError(null);
                  setReviewing(true);
                }}
              >
                {t('settings.save')}
              </button>
            </StickyActionBar>
          </section>
        </div>
      )}

      {reviewing ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) cancelReview();
          }}
          dismissible={!saving}
          maxWidth={560}
          title={t('settings.reviewTitle')}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={cancelReview}
              >
                {t('common.cancel')}
              </button>
              <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
                {saving ? t('common.working') : t('settings.reviewConfirm')}
              </button>
            </>
          }
        >
          <p className="muted">{t('settings.reviewHint')}</p>
          <ul className="settings-diff">
            {changed.map((row) => {
              const after = checks.get(row.key)?.value;
              const warn = warningOf(row, after);
              return (
                <li key={row.key}>
                  <b>{labelOf(row)}</b>
                  <span>
                    <span className="mono">{withUnit(row, row.value)}</span>
                    {' → '}
                    <span className="mono">{withUnit(row, after)}</span>
                  </span>
                  {warn ? <span className="badge warn">{t(warn.key, warn.params)}</span> : null}
                </li>
              );
            })}
          </ul>
          {saveError ? (
            <p className="alert error" role="alert">
              {saveError}
            </p>
          ) : null}
        </Dialog>
      ) : null}

      {asking ? (
        /* "Lưu nhóm này" đi qua ĐÚNG đường của nút Lưu: hộp Trước → Sau rồi step-up — không có
           lối lưu tắt nào bỏ qua bước đọc lại hay bước xác thực. */
        <ConfirmDialog
          title={t('settings.leaveTitle')}
          message={t('settings.leaveMessage', { count: changed.length })}
          confirmLabel={t('settings.save')}
          confirmDisabled={invalid}
          cancelLabel={t('settings.leaveStay')}
          extra={{
            label: t('settings.discard'),
            onClick: () => {
              setLeavingTo(null);
              leave(asking);
            },
          }}
          onConfirm={() => {
            setSaveThenGo(asking);
            setLeavingTo(null);
            setSaveError(null);
            setReviewing(true);
          }}
          onCancel={stay}
        />
      ) : null}

      {stepUp.dialog}
    </>
  );
}
