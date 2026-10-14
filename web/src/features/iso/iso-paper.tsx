import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '@/ui/brand-logo';
import { avIssueMark, avOtherMark, avResultDays, daysOf, groupBackupRows, groupByDivision, pad2, tickIndex, toVnParts } from './iso-rules';
import type { AvIssue, BackupRow, IncidentContent, IncidentKind, IncidentSeverity, IncidentStatus, TickCell } from './iso-types';

/**
 * Bản in tái tạo mẫu giấy SP-IT02 (UX-DR4, Q-28): giữ nguyên cột, bố cục, ô ký. Chữ trên giấy là
 * chữ của mẫu (tiếng Anh như bản gốc ISO), không dịch. Dùng ✓ / ✗ chứ không emoji: máy in và máy
 * chủ không chắc có font emoji.
 */

function lastDayLabel(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${pad2(last)} / ${pad2(month)} / ${year}`;
}

/**
 * Đầu phiếu đúng mẫu: logo PMH góc trái, mã phiếu NGAY DƯỚI logo, tên phiếu giữa trang. Cột phải
 * để trống cho tên phiếu đứng đúng giữa. `rule` = gạch dưới tên phiếu như mẫu Word 0206.
 */
function PaperHead({ code, title, rule }: { code: string; title: string; rule?: boolean }) {
  return (
    <div className="paper-head" data-rule={rule ? '' : undefined}>
      <div className="paper-brand">
        <BrandLogo alt="Phu My Hung" />
        <strong>{code}</strong>
      </div>
      <div className="paper-title">{title}</div>
      <span aria-hidden="true" />
    </div>
  );
}

/** Dòng "System: …" bên trái, khung "Check Date" bên phải — như hàng 3 của mẫu Excel. */
function PaperMeta({ system, checkDate }: { system: string; checkDate: string }) {
  return (
    <div className="paper-meta">
      <strong>{system}</strong>
      <span className="paper-check">
        <strong>Check Date</strong>
        <span>{checkDate}</span>
      </span>
    </div>
  );
}

/**
 * Ô ký: mỗi bên một khung riêng, dòng tên trên, chỗ ký bên dưới. `joined` = hai khung liền nhau
 * giữa trang như mẫu 0206; mặc định hai khung tách trái / phải như mẫu 0203, 0208.
 */
function SignBlock({ left, right, joined }: { left: string; right: string; joined?: boolean }) {
  return (
    <div className="paper-sign" data-joined={joined ? '' : undefined}>
      {[left, right].map((name) => (
        <div key={name} className="paper-sign-box">
          <div>{name}</div>
          <div />
        </div>
      ))}
    </div>
  );
}

/** SP-IT0203 — A3 ngang, Check Date = ngày cuối kỳ (Q-28). */
export function BackupPaper({
  year,
  month,
  systemName,
  rows,
  ticks,
}: {
  year: number;
  month: number;
  systemName: string;
  rows: BackupRow[];
  ticks: TickCell[];
}) {
  const days = daysOf(year, month);
  const grouped = groupBackupRows(rows);
  const index = tickIndex(ticks);
  return (
    <section className="paper" data-page="a3l" aria-label="SP-IT0203">
      <PaperHead code="SP-IT0203" title="System Data Checklist & Storage Record Form" />
      <PaperMeta system={`System: ${systemName}`} checkDate={lastDayLabel(year, month)} />
      <table className="paper-table">
        <thead className="paper-fill-head">
          <tr>
            <th>No</th>
            <th colSpan={2}>Name Job Backup</th>
            <th>Points NAS</th>
            <th>Storage location</th>
            <th>Points Cloud</th>
            <th>Storage location</th>
            {days.map((d) => (
              <th key={d.day}>{d.n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grouped.map((row) => (
            <tr key={row.lineId}>
              {row.first ? <td rowSpan={row.span}>{row.no}</td> : null}
              {row.split ? (
                <>
                  {row.first ? (
                    <td rowSpan={row.span} className="paper-left paper-nowrap">
                      {row.name}
                    </td>
                  ) : null}
                  <td className="paper-left paper-nowrap">{row.label}</td>
                </>
              ) : (
                <td colSpan={2} className="paper-left paper-nowrap">
                  {row.name}
                </td>
              )}
              <td>{row.pointsNas}</td>
              <td>{row.storageNas}</td>
              <td>{row.pointsCloud}</td>
              <td>{row.storageCloud}</td>
              {days.map((d) => {
                const tick = index.get(`${row.lineId}|${d.day}`);
                return <td key={d.day}>{tick ? (tick.result === 'ok' ? '✓' : '✗') : ''}</td>;
              })}
            </tr>
          ))}
          <tr className="paper-fill-note">
            <td colSpan={3}>
              <strong>Note</strong>
            </td>
            <td colSpan={4 + days.length}>Planned Monthly Data Storage Maintenance: Successful: &quot;✓&quot;, Failed: &quot;✗&quot;</td>
          </tr>
        </tbody>
      </table>
      <SignBlock left="IT Department" right="Implementation Personnel" />
    </section>
  );
}

/** SP-IT0208 — chỉ dòng thực sự ghi, gom theo bộ phận; "Other Division" luôn ở cuối (Q-28). */
export function AntivirusPaper({
  year,
  month,
  systemName,
  issues,
  clearDays,
}: {
  year: number;
  month: number;
  systemName: string;
  issues: AvIssue[];
  clearDays: string[];
}) {
  const days = daysOf(year, month);
  const groups = groupByDivision(issues);
  const results = avResultDays(clearDays, issues);
  const fmt = (day: string | null) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '');
  return (
    <section className="paper" data-page="a4l" aria-label="SP-IT0208">
      <PaperHead code="SP-IT0208" title="Antivirus Health Check Form" />
      <PaperMeta system={`System Antivirus: ${systemName}`} checkDate={lastDayLabel(year, month)} />
      <table className="paper-table">
        <thead className="paper-fill-head">
          <tr>
            <th>Reported Date</th>
            <th>Computer Name</th>
            <th>Incident Description</th>
            <th>Resolution Date</th>
            <th>Handled</th>
            {days.map((d) => (
              <th key={d.day}>{d.n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.divisionId}>
              <tr className="paper-group">
                <td colSpan={5}>{group.divisionName}</td>
                <td colSpan={days.length} className="paper-fill-day" />
              </tr>
              {group.issues.map((issue) => (
                <tr key={issue.id}>
                  <td>{fmt(issue.reportedOn)}</td>
                  <td>{issue.computerName}</td>
                  <td className="paper-left">{issue.description}</td>
                  <td>{fmt(issue.resolvedOn)}</td>
                  <td>{issue.handledBy}</td>
                  {days.map((d) => (
                    <td key={d.day}>{avIssueMark(issue, d.day, results)}</td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
          <tr className="paper-group">
            <td colSpan={5}>Other Division</td>
            {days.map((d) => (
              <td key={d.day}>{avOtherMark(d.day, results)}</td>
            ))}
          </tr>
          <tr className="paper-fill-note">
            <td>
              <strong>Notes</strong>
            </td>
            <td colSpan={4 + days.length} className="paper-left">
              Monthly Data Storage Maintenance Plan: Good Status: &quot;✓&quot;, Failure: &quot;✗&quot;
            </td>
          </tr>
        </tbody>
      </table>
      <SignBlock left="IT Department" right="Implementation Personnel" />
    </section>
  );
}

function Box({ on }: { on: boolean }) {
  return <span className="paper-box">{on ? '✓' : ''}</span>;
}

export const KIND_LABEL: Record<IncidentKind, string> = { backup: 'Backup', server: 'Server', network: 'Network', database: 'Database', other: 'Other' };
export const SEVERITY_LABEL: Record<IncidentSeverity, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const STATUS_LABEL: Record<IncidentStatus, string> = { temporary_fix: 'Temporary Fix (if any)', resolved: 'Resolved', in_progress: 'In Progress' };

function stamp(iso: string | null): string {
  if (!iso) return '';
  const { date, time } = toVnParts(iso);
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)} ${time}`;
}

interface IncidentSlots {
  reported: ReactNode;
  detected: ReactNode;
  resolved: ReactNode;
  kind: ReactNode;
  severity: ReactNode;
  description: ReactNode;
  action: ReactNode;
  status: ReactNode;
}

/** Khung mục 1 của SP-IT0206 đúng bố cục mẫu Word. */
function IncidentInfoTable({ slots }: { slots: IncidentSlots }) {
  return (
    <table className="paper-table paper-form">
      <colgroup>
        <col className="paper-col-label" />
        <col />
        <col className="paper-col-label" />
        <col />
      </colgroup>
      <tbody>
        <tr>
          <th colSpan={4} className="paper-band">
            1. Incident Information
          </th>
        </tr>
        <tr>
          <th className="paper-label">Date Report</th>
          <td className="paper-left">{slots.reported}</td>
          <th rowSpan={2} className="paper-label">
            Type of Incident
          </th>
          <td rowSpan={2} className="paper-left">
            {slots.kind}
          </td>
        </tr>
        <tr>
          <th className="paper-label">Detection Time</th>
          <td className="paper-left">{slots.detected}</td>
        </tr>
        <tr>
          <th className="paper-label">Resolution Time</th>
          <td className="paper-left">{slots.resolved}</td>
          <th className="paper-label">Severity Level</th>
          <td className="paper-left">{slots.severity}</td>
        </tr>
        <tr>
          <th colSpan={2}>Incident Description</th>
          <th colSpan={2}>Corrective Action</th>
        </tr>
        <tr className="paper-tall">
          <td colSpan={2} className="paper-left paper-top">
            {slots.description}
          </td>
          <td colSpan={2} className="paper-left paper-top">
            {slots.action}
          </td>
        </tr>
        <tr>
          <th className="paper-label">Current Status</th>
          <td colSpan={3} className="paper-left">
            {slots.status}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Đầu bảng mục 2 "Detail Error Backup". */
function BackupDetailHead() {
  return (
    <thead>
      <tr>
        <th colSpan={10} className="paper-band">
          2. Detail Error Backup
        </th>
      </tr>
      <tr>
        <th rowSpan={2}>Job Name</th>
        <th colSpan={3}>Type Backup</th>
        <th colSpan={3}>Type Data</th>
        <th rowSpan={2}>Storage Location</th>
        <th rowSpan={2}>Error Message</th>
        <th rowSpan={2}>Issue Resolution</th>
      </tr>
      <tr>
        <th>Full</th>
        <th>Incr</th>
        <th>Copy</th>
        <th>DB</th>
        <th>App</th>
        <th>FileSV</th>
      </tr>
    </thead>
  );
}

function Options<K extends string>({ labels, value }: { labels: Record<K, string>; value: K | null }) {
  return (
    <span className="paper-options">
      {(Object.keys(labels) as K[]).map((key) => (
        <span key={key}>
          <Box on={value === key} />
          {labels[key]}
        </span>
      ))}
    </span>
  );
}

/**
 * SP-IT0206 — Daily Incident Report Form. Số phiếu chỉ hiện trên IMS, KHÔNG in lên giấy (Q-28).
 * Bảng "Detail Error Backup" chỉ có ở loại Backup, đủ 11 dòng như mẫu.
 */
export function IncidentPaper({ incident }: { incident: IncidentContent }) {
  const { t } = useTranslation();
  const rows = incident.kind === 'backup' ? [...incident.backupDetails, ...Array(Math.max(0, 11 - incident.backupDetails.length)).fill(null)] : [];
  const reported = incident.reportedOn ? `${incident.reportedOn.slice(8, 10)}/${incident.reportedOn.slice(5, 7)}/${incident.reportedOn.slice(0, 4)}` : '';
  return (
    <section className="paper" data-page="a4" aria-label="SP-IT0206">
      <PaperHead code="SP-IT0206" title="DAILY INCIDENT REPORT FORM" rule />
      <IncidentInfoTable
        slots={{
          reported,
          detected: stamp(incident.detectedAt),
          resolved: stamp(incident.resolvedAt),
          kind: <Options labels={KIND_LABEL} value={incident.kind} />,
          severity: <Options labels={SEVERITY_LABEL} value={incident.severity} />,
          description: incident.description,
          action: incident.correctiveAction,
          status: <Options labels={STATUS_LABEL} value={incident.status} />,
        }}
      />
      {incident.kind === 'backup' ? (
        <table className="paper-table paper-form paper-detail">
          {/* Như mẫu Word: sáu cột Type Backup / Type Data chỉ là ô tick hẹp đánh dấu job lỗi ở
              đâu; chữ dài (tên job, thông báo lỗi) xuống dòng trong ô, không tràn sang cột bên. */}
          <colgroup>
            <col className="paper-col-job" />
            {Array.from({ length: 6 }, (_, k) => (
              <col key={k} className="paper-col-tick" />
            ))}
            <col className="paper-col-storage" />
            <col />
            <col />
          </colgroup>
          <BackupDetailHead />
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="paper-left">{row?.jobName ?? ' '}</td>
                {(['full', 'incr', 'copy'] as const).map((k) => (
                  <td key={k}>{row?.typeBackup === k ? '✓' : ''}</td>
                ))}
                {(['db', 'app', 'filesv'] as const).map((k) => (
                  <td key={k}>{row?.typeData === k ? '✓' : ''}</td>
                ))}
                <td>{row?.storage}</td>
                <td className="paper-left">{row?.errorMessage}</td>
                <td className="paper-left">{row?.resolution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <SignBlock left="Reported By" right="Reviewed and Approved By" joined />
      <p className="muted small no-print">{t('iso.incident.signNote')}</p>
    </section>
  );
}
