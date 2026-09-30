import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorCode, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { Dialog } from '@/ui/dialog';
import { LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { StickyActionBar } from '@/ui/sticky-action-bar';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { useToast } from '@/ui/toast';
import { checkDraft, toDraft, warningOf, type SettingRow } from './settings-rules';

type Group = SettingRow['group'];

const GROUPS: { key: Group; label: string }[] = [
  { key: 'auth', label: 'settings.groupAuth' },
  { key: 'vault', label: 'settings.groupVault' },
  { key: 'approval', label: 'settings.groupApproval' },
  { key: 'expiry', label: 'settings.groupExpiry' },
  { key: 'dashboard', label: 'settings.groupDashboard' },
  { key: 'software', label: 'settings.groupSoftware' },
  { key: 'ipam', label: 'settings.groupIpam' },
  { key: 'files', label: 'settings.groupFiles' },
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
  files: 'settings.unitFiles',
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
  authSupportContact: ['settings.authSupportContactLabel', 'settings.authSupportContactDesc'],
  secretRevealSeconds: ['settings.secretRevealSecondsLabel', 'settings.secretRevealSecondsDesc'],
  secretStepUpGraceMinutes: ['settings.secretStepUpGraceMinutesLabel', 'settings.secretStepUpGraceMinutesDesc'],
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
  fileMaxSizeMb: ['settings.fileMaxSizeMbLabel', 'settings.fileMaxSizeMbDesc'],
  fileMaxFilesPerBatch: ['settings.fileMaxFilesPerBatchLabel', 'settings.fileMaxFilesPerBatchDesc'],
  filePurgeAfterDays: ['settings.filePurgeAfterDaysLabel', 'settings.filePurgeAfterDaysDesc'],
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

  const list = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<SettingRow[]>('/api/v1/admin/settings'),
  });

  const rows = useMemo(() => (list.data ?? []).filter((row) => row.group === group), [list.data, group]);
  const draftOf = (row: SettingRow) => drafts[row.key] ?? toDraft(row.value);
  const changed = rows.filter((row) => draftOf(row).trim() !== toDraft(row.value));
  const checks = new Map(rows.map((row) => [row.key, checkDraft(row, draftOf(row))]));
  const invalid = changed.some((row) => checks.get(row.key)?.reason);

  const labelOf = (row: SettingRow) => (TEXT[row.name] ? t(TEXT[row.name][0]) : row.key);
  const withUnit = (row: SettingRow, value: unknown) =>
    value === '' || value === null || value === undefined
      ? t('settings.blank')
      : row.unit
        ? `${String(value)} ${t(UNIT[row.unit])}`
        : String(value);

  const switchGroup = (next: Group) => {
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
      const next = await stepUp.run(() =>
        apiFetch<SettingRow[]>('/api/v1/admin/settings', {
          method: 'PATCH',
          csrfToken: me.csrfToken,
          body: JSON.stringify(body),
        }),
      );
      queryClient.setQueryData(SETTINGS_KEY, next);
      toast({ message: t('settings.saved', { count: changed.length }) });
      setDrafts({});
      setReviewing(false);
    } catch (err) {
      if (!(err instanceof Error && err.message === 'STEPUP_CANCELLED')) {
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

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="settings-layout">
          <nav aria-label={t('settings.groupsNav')} className="settings-nav">
            <ul>
              {GROUPS.map((g) => (
                <li key={g.key}>
                  <button
                    type="button"
                    aria-current={g.key === group ? 'page' : undefined}
                    onClick={() => switchGroup(g.key)}
                  >
                    {t(g.label)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section className="card settings-panel" aria-labelledby="settings-group-title">
            <h2 id="settings-group-title">{t(GROUPS.find((g) => g.key === group)?.label ?? '')}</h2>
            {rows.map((row) => {
              const id = `setting-${row.key.replace(/\W/g, '-')}`;
              const check = checks.get(row.key) ?? checkDraft(row, draftOf(row));
              const dirty = draftOf(row).trim() !== toDraft(row.value);
              const warn = dirty ? warningOf(row, check.value) : null;
              return (
                <div key={row.key} className="settings-row">
                  <Field
                    label={labelOf(row)}
                    htmlFor={id}
                    hint={TEXT[row.name] ? t(TEXT[row.name][1]) : undefined}
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
                  <p className="muted settings-meta">
                    {t('settings.defaultIs', { value: withUnit(row, row.defaultValue) })}
                    {' · '}
                    {row.updatedBy && row.updatedAt
                      ? t('settings.lastEdited', { who: row.updatedBy, at: formatDateTime(row.updatedAt) })
                      : t('settings.neverEdited')}
                  </p>
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
              label={t('settings.save')}
              note={changed.length > 0 ? t('settings.dirty', { count: changed.length }) : undefined}
            >
              <button
                type="button"
                className="btn"
                disabled={changed.length === 0}
                onClick={() => setDrafts({})}
              >
                {t('settings.discard')}
              </button>
              <button
                type="button"
                className="btn primary"
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
            if (!open) setReviewing(false);
          }}
          dismissible={!saving}
          maxWidth={560}
          title={t('settings.reviewTitle')}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setReviewing(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
                {saving ? t('common.loading') : t('settings.reviewConfirm')}
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

      {stepUp.dialog}
    </>
  );
}
