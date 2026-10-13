import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { avIssueMark, avOtherMark, avResultDays, daysOf, groupBackupRows, groupByDivision, pad2, tickIndex, toVnParts } from './iso-rules';
import type { AvIssue, BackupRow, IncidentContent, TickCell } from './iso-types';

/**
 * Bản in tái tạo mẫu giấy SP-IT02 (UX-DR4, Q-28): giữ nguyên cột, bố cục, ô ký. Chữ trên giấy là
 * chữ của mẫu (tiếng Anh như bản gốc ISO), không dịch. Dùng ✓ / ✗ chứ không emoji: máy in và máy
 * chủ không chắc có font emoji.
 */

function lastDayLabel(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${pad2(last)} / ${pad2(month)} / ${year}`;
}

function PaperHead({ code, title }: { code: string; title: string }) {
  return (
    <div className="paper-head">
      <div>
        <strong>PMH</strong>
      </div>
      <div className="paper-title">{title}</div>
      <div>
        <strong>{code}</strong>
      </div>
    </div>
  );
}

function SignBlock({ left, right }: { left: string; right: string }) {
  return (
    <div className="paper-sign">
      <div>{left}</div>
      <div>{right}</div>
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
  const hasSubs = new Set(rows.filter((r) => r.label).map((r) => r.jobId));
  return (
    <section className="paper" data-page="a3l" aria-label="SP-IT0203">
      <PaperHead code="SP-IT0203" title="System Data Checklist & Storage Record Form" />
      <div className="paper-meta">
        <span>System: {systemName}</span>
        <span>Check Date {lastDayLabel(year, month)}</span>
      </div>
      <table className="paper-table">
        <thead>
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
              {hasSubs.has(row.jobId) ? (
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
          <tr>
            <td colSpan={3} className="paper-left">
              <strong>Note</strong>
            </td>
            <td colSpan={4 + days.length} className="paper-left">
              Planned Monthly Data Storage Maintenance: Successful: &quot;✓&quot;, Failed: &quot;✗&quot;
            </td>
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
      <div className="paper-meta">
        <span>System Antivirus: {systemName}</span>
        <span>Check Date {lastDayLabel(year, month)}</span>
      </div>
      <table className="paper-table">
        <thead>
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
                <td colSpan={5 + days.length}>{group.divisionName}</td>
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
          <tr>
            <td className="paper-left">
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

const KIND_LABEL: Record<string, string> = { backup: 'Backup', server: 'Server', network: 'Network', database: 'Database', other: 'Other' };
const SEVERITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const STATUS_LABEL: Record<string, string> = { temporary_fix: 'Temporary Fix (if any)', resolved: 'Resolved', in_progress: 'In Progress' };

function stamp(iso: string | null): string {
  if (!iso) return '';
  const { date, time } = toVnParts(iso);
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)} ${time}`;
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
      <PaperHead code="SP-IT0206" title="Daily Incident Report Form" />
      <p className="paper-section">1. Incident Information</p>
      <table className="paper-table">
        <tbody>
          <tr>
            <th className="paper-label">Date Report</th>
            <td className="paper-left">{reported}</td>
            <th className="paper-label">Type of Incident</th>
            <td className="paper-left">
              <span className="paper-options">
                {Object.entries(KIND_LABEL).map(([key, label]) => (
                  <span key={key}>
                    <Box on={incident.kind === key} />
                    {label}
                  </span>
                ))}
              </span>
            </td>
          </tr>
          <tr>
            <th className="paper-label">Detection Time</th>
            <td className="paper-left">{stamp(incident.detectedAt)}</td>
            <th className="paper-label">Resolution Time</th>
            <td className="paper-left">{stamp(incident.resolvedAt)}</td>
          </tr>
          <tr>
            <th className="paper-label">Severity Level</th>
            <td colSpan={3} className="paper-left">
              <span className="paper-options">
                {Object.entries(SEVERITY_LABEL).map(([key, label]) => (
                  <span key={key}>
                    <Box on={incident.severity === key} />
                    {label}
                  </span>
                ))}
              </span>
            </td>
          </tr>
          <tr>
            <th className="paper-label">Incident Description</th>
            <td colSpan={3} className="paper-left">
              {incident.description}
            </td>
          </tr>
          <tr>
            <th className="paper-label">Corrective Action</th>
            <td colSpan={3} className="paper-left">
              {incident.correctiveAction}
            </td>
          </tr>
          <tr>
            <th className="paper-label">Current Status</th>
            <td colSpan={3} className="paper-left">
              <span className="paper-options">
                {Object.entries(STATUS_LABEL).map(([key, label]) => (
                  <span key={key}>
                    <Box on={incident.status === key} />
                    {label}
                  </span>
                ))}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      {incident.kind === 'backup' ? (
        <>
          <p className="paper-section">2. Detail Error Backup</p>
          <table className="paper-table">
            <thead>
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
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="paper-left">{row?.jobName ?? ' '}</td>
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
        </>
      ) : null}
      <SignBlock left="Reported By" right="Reviewed and Approved By" />
      <p className="muted small no-print">{t('iso.incident.signNote')}</p>
    </section>
  );
}
