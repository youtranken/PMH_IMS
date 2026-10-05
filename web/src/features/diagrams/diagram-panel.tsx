import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { errorCode, errorMessage } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { LoadError, Loading } from '@/ui/load-state';
import { RowActions, type RowAction } from '@/ui/row-actions';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import { publicationsKey, statusLabel, versionsKey, type DiagramNode, type Publications, type VersionItem } from './diagram-api';
import { draftSelection, seqRangeText, siblingsOf, tickDraft, tileTone, versionSections } from './diagram-map';
import { canManageNode, newerOfficialSeq } from './diagram-presentation';
import { usePublishFlow } from './diagram-review';
import { pathOf } from './diagram-tree';
import { DiagramVersionsDialog, useVersionActions } from './diagram-versions-dialog';

type Run = <T>(action: () => Promise<T>, purpose: string) => Promise<T>;

/** Phiên bản đã phát hành hiện sẵn; còn lại sau nút "Xem thêm". */
const PUBLISHED_SHOWN = 4;

const TONE_BADGE = { ok: 'badge ok', warn: 'badge warn', info: 'badge info', danger: 'badge danger', muted: 'badge muted' } as const;

/**
 * Panel của bản vẽ đang chọn trên /diagrams (Q-23): chuyển nhanh giữa các bản vẽ cùng khu, Mở /
 * Sửa, "Nháp chưa phát hành" (tick một bản thì các bản mới hơn theo — bỏ nháp chỉ cắt đuôi) và
 * "Đã phát hành" (giữ mãi). Tên, trạng thái, số đếm là thông tin của cây; danh sách phiên bản là
 * nội dung bản vẽ nên vẫn qua mã sơ đồ — thử đọc thẳng (còn ân hạn thì có ngay), server đòi mã
 * thì hiện nút "Nhập mã để xem lịch sử" tại chỗ, KHÔNG tự bật hộp hỏi mã chỉ vì người dùng bấm
 * chọn một ô.
 */
export function DiagramPanel({
  me,
  node,
  nodes,
  run,
  canEdit,
  actions,
  onSelect,
  discard,
}: {
  me: Me;
  node: DiagramNode;
  nodes: DiagramNode[];
  run: Run;
  /** Màn đủ rộng cho trình vẽ — màn hẹp chỉ xem (Q-23): không Sửa / Phát hành / Gửi duyệt. */
  canEdit: boolean;
  /** Menu ⋮ của bản vẽ (trình chiếu, thêm con, đổi tên, lưu trữ, xoá hẳn). */
  actions: RowAction[];
  onSelect: (id: string) => void;
  discard: (node: DiagramNode, fromSeq: number) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  /*
   * Dấu tick và "Xem thêm" gắn với MỘT bản vẽ: chuyển sang bản khác (dải chuyển nhanh) thì về
   * trắng. Không remount panel theo `key` — thanh tab đang giữ tiêu điểm bàn phím.
   */
  const [picks, setPicks] = useState<{ id: string; from: number | null; showAll: boolean }>({ id: node.id, from: null, showAll: false });
  const own = picks.id === node.id ? picks : { id: node.id, from: null, showAll: false };
  const from = own.from;
  const showAll = own.showAll;
  const setFrom = (next: number | null) => setPicks({ ...own, from: next });
  const setShowAll = (next: boolean) => setPicks({ ...own, showAll: next });
  const [versionsOpen, setVersionsOpen] = useState(false);
  const flow = usePublishFlow({ me, diagram: node, run });
  const versionActions = useVersionActions({ me, diagram: node, run, onRestored: () => undefined });
  const purpose = t('diagrams.panel.unlockPurpose', { name: node.name });

  const versions = useQuery({
    queryKey: versionsKey(node.id),
    queryFn: () => apiFetch<VersionItem[]>(`/api/v1/diagrams/${node.id}/versions`),
    enabled: Boolean(node.latestVersion),
    retry: false,
  });
  const publications = useQuery({
    queryKey: publicationsKey(node.id),
    queryFn: () => apiFetch<Publications>(`/api/v1/diagrams/${node.id}/publications`),
    enabled: Boolean(node.latestVersion),
    retry: false,
  });
  const locked = errorCode(versions.error) === 'STEPUP_REQUIRED' || errorCode(publications.error) === 'STEPUP_REQUIRED';

  const unlock = async () => {
    try {
      await run(() => apiFetch(`/api/v1/diagrams/${node.id}/versions`), purpose);
      await Promise.all([versions.refetch(), publications.refetch()]);
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const official = nodes.filter((n) => n.kind !== 'presentation');
  const path = node.kind === 'presentation' ? [] : pathOf(official, node.id);
  const parent = path.length > 1 ? path[path.length - 2] : null;
  const siblings = siblingsOf(nodes, node.id);
  const siblingsLabel =
    node.kind === 'presentation'
      ? t('diagrams.panel.siblingsPresentations')
      : parent
        ? t('diagrams.panel.siblingsOf', { name: parent.name })
        : t('diagrams.panel.siblingsRoots');

  const stats = [
    node.versionCount ? t('diagrams.panel.versions', { count: node.versionCount }) : null,
    node.stats?.devices ? t('diagrams.panel.devices', { count: node.stats.devices }) : null,
    node.stats?.cables ? t('diagrams.panel.cables', { count: node.stats.cables }) : null,
    node.stats?.cabinets ? t('diagrams.panel.cabinets', { count: node.stats.cabinets }) : null,
    node.ownerEmail ? t('diagrams.panel.owner', { owner: node.ownerEmail }) : null,
  ].filter(Boolean);

  const latest = node.latestVersion;
  const newer = node.kind === 'presentation' ? newerOfficialSeq(node.source) : null;
  const hasDraft = Boolean(latest) && (node.draftCount ?? 0) > 0;
  const manager = me.role === 'sa' || me.role === 'admin';
  const reviewable = node.kind === 'official';
  const canSend = canEdit && reviewable && hasDraft && !node.pendingApprovalId && node.status !== 'pending';

  const sections =
    versions.data && publications.data ? versionSections(versions.data, publications.data.officialVersionId, publications.data.publishedVersionIds) : null;
  const picked = sections ? draftSelection(sections.drafts, from) : [];
  const latestId = versions.data?.[0]?.id ?? null;
  // Cùng luật với server (`assertCanDiscard`): Admin/SA, hoặc chủ bản trình bày.
  const canDiscard = canManageNode(node, me);

  const viewVersion = (version: VersionItem) => navigate(`${PATHS.diagram(node.id)}?${new URLSearchParams({ version: version.id }).toString()}`);
  const compare = (version: VersionItem) =>
    latestId && navigate(`${PATHS.diagram(node.id)}?${new URLSearchParams({ version: latestId, compare: version.id }).toString()}`);

  let history;
  if (!latest) history = null;
  else if (locked) {
    history = (
      <div className="dpanel-locked">
        <p className="muted">{t('diagrams.panel.locked')}</p>
        <button type="button" className="btn sm" onClick={() => void unlock()}>
          {t('diagrams.panel.unlock')}
        </button>
      </div>
    );
  } else if (versions.isPending || publications.isPending) history = <Loading />;
  else if (versions.isError || publications.isError) {
    history = <LoadError error={versions.error ?? publications.error} onRetry={() => void Promise.all([versions.refetch(), publications.refetch()])} />;
  } else if (sections) {
    const shown = showAll ? sections.published : sections.published.slice(0, PUBLISHED_SHOWN);
    history = (
      <>
        <section className="dpanel-drafts" aria-labelledby={`dpanel-drafts-${node.id}`}>
          <div className="dpanel-section-head">
            <h3 id={`dpanel-drafts-${node.id}`}>{t('diagrams.panel.draftsTitle', { count: sections.drafts.length })}</h3>
            {sections.drafts.some((d) => d.checkable) && canDiscard ? <span className="muted">{t('diagrams.panel.draftsHint')}</span> : null}
          </div>
          {sections.drafts.length === 0 ? <p className="muted">{t('diagrams.panel.noDrafts')}</p> : null}
          <ul className="dpanel-rows">
            {sections.drafts.map((draft) => {
              const seq = draft.version.seq;
              const checked = picked.includes(seq);
              return (
                <li key={draft.version.id} className="dpanel-row" data-checked={checked ? 'true' : undefined}>
                  {canDiscard ? (
                    <input
                      type="checkbox"
                      aria-label={t('diagrams.panel.draftOf', { seq })}
                      checked={checked}
                      disabled={!draft.checkable}
                      onChange={(event) => setFrom(tickDraft(sections.drafts, from, seq, event.target.checked))}
                    />
                  ) : null}
                  <span className="dpanel-row-text">
                    <strong>{t('diagrams.panel.draftTitle', { seq, summary: draft.version.label ?? draft.version.brief ?? draft.version.summary })}</strong>
                    <span className="muted">
                      {t('diagrams.panel.savedMeta', { by: draft.version.savedByName ?? draft.version.savedBy, at: formatDateTime(draft.version.savedAt) })}
                      {draft.keptBecause ? ` · ${t(draft.keptBecause === 'named' ? 'diagrams.panel.keptNamed' : 'diagrams.panel.keptFirst')}` : ''}
                    </span>
                    {draft.version.overwrote ? <span className="badge muted dpanel-tag">{t('diagrams.panel.overwrote', { name: draft.version.overwrote })}</span> : null}
                  </span>
                  <button type="button" className="btn sm ghost" aria-label={t('diagrams.panel.viewOf', { seq })} onClick={() => viewVersion(draft.version)}>
                    {t('diagrams.panel.view')}
                  </button>
                </li>
              );
            })}
          </ul>
          {(canDiscard && sections.drafts.some((d) => d.checkable)) || canSend ? (
            <div className="dpanel-foot">
              {canDiscard && sections.drafts.some((d) => d.checkable) ? (
                <>
                  <span className="grow" role="status">
                    {picked.length > 0 ? t('diagrams.panel.selected', { ranges: seqRangeText(picked) }) : t('diagrams.panel.selectedNone')}
                  </span>
                  <button
                    type="button"
                    className="btn sm danger-ghost"
                    disabled={from === null}
                    onClick={() => {
                      if (from === null) return;
                      void discard(node, from).then((done) => {
                        if (done) setFrom(null);
                      });
                    }}
                  >
                    {t('diagrams.panel.discard', { count: picked.length })}
                  </button>
                </>
              ) : (
                <span className="grow" />
              )}
              {canSend && latest ? (
                <button type="button" className="btn sm primary" onClick={() => (manager ? void flow.publish() : flow.openSubmit())}>
                  {t(manager ? 'diagrams.panel.publish' : 'diagrams.panel.submit', { seq: latest.seq })}
                </button>
              ) : null}
            </div>
          ) : null}
          {node.pendingApprovalId ? <p className="muted">{t('diagrams.panel.pending')}</p> : null}
        </section>
        {reviewable ? (
          <section className="dpanel-published" aria-labelledby={`dpanel-published-${node.id}`}>
            <div className="dpanel-section-head">
              <h3 id={`dpanel-published-${node.id}`}>{t('diagrams.panel.publishedTitle', { count: sections.published.length })}</h3>
              <span className="muted">{t('diagrams.panel.keepForever')}</span>
            </div>
            {sections.published.length === 0 ? <p className="muted">{t('diagrams.panel.noPublished')}</p> : null}
            <ul className="dpanel-rows">
              {shown.map((version) => {
                const isOfficial = version.id === publications.data?.officialVersionId;
                const menu: RowAction[] = [];
                if (versionActions.canLabel(version)) menu.push({ key: 'label', label: t('diagrams.versions.name'), onSelect: () => versionActions.startLabel(version) });
                if (versionActions.canRestore && version.id !== latestId) {
                  menu.push({ key: 'restore', label: t('diagrams.versions.restore'), onSelect: () => void versionActions.restore(version) });
                }
                if (versionActions.canRestore && !isOfficial) {
                  menu.push({ key: 'restore-official', label: t('diagrams.review.restoreOfficial'), onSelect: () => void versionActions.restoreOfficial(version) });
                }
                return (
                  <li key={version.id} className="dpanel-row" data-official={isOfficial ? 'true' : undefined}>
                    <span className="dpanel-dot" aria-hidden="true" />
                    <span className="dpanel-row-text">
                      <strong>
                        {version.label
                          ? t('diagrams.panel.publishedRowNamed', { seq: version.seq, label: version.label })
                          : t('diagrams.panel.publishedRow', { seq: version.seq })}
                        {isOfficial ? <span className="badge ok">{t('diagrams.panel.current')}</span> : null}
                      </strong>
                      <span className="muted">
                        {t('diagrams.panel.savedMeta', { by: version.savedByName ?? version.savedBy, at: formatDateTime(version.savedAt) })}
                      </span>
                    </span>
                    <button type="button" className="btn sm ghost" aria-label={t('diagrams.panel.viewOf', { seq: version.seq })} onClick={() => viewVersion(version)}>
                      {t('diagrams.panel.view')}
                    </button>
                    {version.id !== latestId ? (
                      <button type="button" className="btn sm ghost" aria-label={t('diagrams.panel.compareOf', { seq: version.seq })} onClick={() => compare(version)}>
                        {t('diagrams.panel.compare')}
                      </button>
                    ) : null}
                    {menu.length > 0 ? <RowActions label={t('diagrams.panel.moreOf', { seq: version.seq })} items={menu} /> : null}
                  </li>
                );
              })}
            </ul>
            {!showAll && sections.published.length > PUBLISHED_SHOWN ? (
              <button type="button" className="btn sm ghost" onClick={() => setShowAll(true)}>
                {t('diagrams.panel.showOlder', { count: sections.published.length - PUBLISHED_SHOWN })}
              </button>
            ) : null}
          </section>
        ) : null}
        <button type="button" className="linkbtn" onClick={() => setVersionsOpen(true)}>
          {t('diagrams.panel.allVersions')}
        </button>
      </>
    );
  }

  return (
    <div className="dpanel">
      <div className="dpanel-top">
        {path.length > 1 ? <span className="muted dpanel-path">{path.map((n) => n.name).join(' › ')}</span> : null}
        {siblings.length > 1 ? (
          <Tabs
            wrap
            ariaLabel={siblingsLabel}
            value={node.id}
            onChange={onSelect}
            items={siblings.map((s) => ({ key: s.id, label: s.name, count: s.versionCount }))}
          />
        ) : null}
      </div>
      <TabPanel tabKey={node.id}>
        <div className="dpanel-head">
          <div className="dpanel-title">
            <h2>{node.name}</h2>
            {stats.length > 0 ? <span className="muted">{stats.join(' · ')}</span> : null}
            {node.kind === 'presentation' ? (
              <span className="muted">
                {node.source?.name && node.source.seq
                  ? t('diagrams.presentation.fromSource', { name: node.source.name, seq: node.source.seq })
                  : t('diagrams.presentation.fromSourceGone')}
              </span>
            ) : null}
            {newer ? <span className="badge warn">{t('diagrams.presentation.newer', { seq: newer })}</span> : null}
          </div>
          <span className={TONE_BADGE[tileTone(node)]}>{statusLabel(node, t)}</span>
          {actions.length > 0 ? <RowActions label={t('diagrams.actionsOf', { name: node.name })} items={actions} /> : null}
        </div>
        <div className="dpanel-actions">
          <button type="button" className="btn primary" onClick={() => navigate(PATHS.diagram(node.id))}>
            {node.officialVersionId ? t('diagrams.panel.openOfficial') : t('diagrams.panel.open')}
          </button>
          {canEdit ? (
            <button type="button" className="btn" onClick={() => navigate(`${PATHS.diagram(node.id)}?mode=edit`)}>
              {hasDraft && latest ? t('diagrams.panel.editDraft', { seq: latest.seq }) : t('diagrams.panel.edit')}
            </button>
          ) : null}
        </div>
        {history}
      </TabPanel>
      {flow.dialogs}
      {versionActions.dialogs}
      {versionsOpen ? (
        <DiagramVersionsDialog
          me={me}
          diagram={node}
          run={run}
          onRestored={() => undefined}
          onView={(version) => {
            setVersionsOpen(false);
            viewVersion(version);
          }}
          onCompare={(fromVersion, to) => {
            setVersionsOpen(false);
            navigate(`${PATHS.diagram(node.id)}?${new URLSearchParams({ version: to.id, compare: fromVersion.id }).toString()}`);
          }}
          onClose={() => setVersionsOpen(false)}
        />
      ) : null}
    </div>
  );
}
