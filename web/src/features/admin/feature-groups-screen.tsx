import { Fragment, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { FEATURE_TICKS } from '@/lib/features';
import type { Me } from '@/lib/me';
import { useConfirm } from '@/ui/confirm-context';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { ScrollX } from '@/ui/scroll-x';
import { StickyActionBar } from '@/ui/sticky-action-bar';
import { useToast } from '@/ui/toast';
import { FEATURE_GROUPS_KEY, useFeatureGroups, type FeatureGroup } from '@/ui/use-feature-groups';
import { useSubmitError } from '@/ui/use-form-errors';
import { useUnsavedGuard } from '@/ui/use-unsaved-guard';
import { changedGroups, FEATURE_ROWS, lockedBy, toggleTick } from './feature-groups-rules';

/**
 * Nhóm quyền của Thành viên (Q-31) — bảng tick: hàng là mục, cột là nhóm. Chỉ SA. Màn nhập
 * desktop (grid tick, UX-DR2 không đòi 390px).
 */
export function FeatureGroupsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const groups = useFeatureGroups();
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [naming, setNaming] = useState<FeatureGroup | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useSubmitError([drafts]);
  const list = groups.data ?? [];
  const changed = changedGroups(list, drafts);
  const guard = useUnsavedGuard(changed.length > 0);
  const refresh = () => queryClient.invalidateQueries({ queryKey: FEATURE_GROUPS_KEY });

  const patch = useApiMutation<{ id: string; name?: string; features?: string[] }, unknown>(
    (input) => `/api/v1/feature-groups/${input.id}`,
    { method: 'PATCH', csrfToken: me.csrfToken, refreshMe: false, body: ({ id: _id, ...rest }) => rest },
  );
  const remove = useApiMutation<{ id: string }, unknown>((input) => `/api/v1/feature-groups/${input.id}`, {
    method: 'DELETE',
    csrfToken: me.csrfToken,
    refreshMe: false,
    body: () => undefined,
  });

  const save = async () => {
    setError(null);
    const empty = changed.find((group) => group.empty);
    if (empty) {
      setError(t('featureGroups.needOneTick', { name: empty.name }));
      return;
    }
    setSaving(true);
    try {
      // Từng nhóm một: lỗi ở nhóm sau (người phụ trách phiếu) không được làm mất nhóm đã lưu.
      for (const group of changed) {
        await patch.mutateAsync({ id: group.id, features: group.features });
        setDrafts((current) => {
          const rest = { ...current };
          delete rest[group.id];
          return rest;
        });
      }
      toast({ message: t('featureGroups.saved') });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
      void refresh();
    }
  };

  const deleteGroup = async (group: FeatureGroup) => {
    const ok = await askConfirm({
      title: t('featureGroups.deleteTitle', { name: group.name }),
      message: t('featureGroups.deleteMessage'),
      danger: true,
      confirmLabel: t('featureGroups.delete'),
    });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id: group.id });
      toast({ message: t('featureGroups.deleted', { name: group.name }) });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      void refresh();
    }
  };

  const header = (
    <PageHeader
      title={t('nav.featureGroups')}
      actions={
        list.length > 0 ? (
          <button type="button" className="btn primary" onClick={() => setNaming('new')}>
            {t('featureGroups.add')}
          </button>
        ) : null
      }
    />
  );

  if (groups.isError) {
    return (
      <>
        {header}
        <LoadError error={groups.error} onRetry={() => void groups.refetch()} />
      </>
    );
  }
  if (!groups.data) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }

  return (
    <>
      {header}
      {list.length === 0 ? (
        <EmptyState
          title={t('featureGroups.empty')}
          hint={t('featureGroups.emptyHint')}
          action={
            <button type="button" className="btn primary" onClick={() => setNaming('new')}>
              {t('featureGroups.add')}
            </button>
          }
        />
      ) : (
        <section className="card">
          <ScrollX ariaLabel={t('nav.featureGroups')}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">{t('featureGroups.feature')}</span>
                  </th>
                  {list.map((group) => (
                    <th key={group.id} scope="col" className="col-center">
                      {group.name}
                      <span className="cell-sub">{t('featureGroups.members', { count: group.memberCount })}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_ROWS.map((row, index) => (
                  <Fragment key={row.tick}>
                    {row.underIso && !FEATURE_ROWS[index - 1]?.underIso ? (
                      <tr className="row-group">
                        <th scope="rowgroup" colSpan={list.length + 1}>
                          {t('nav.groupIso')}
                        </th>
                      </tr>
                    ) : null}
                    <tr>
                      <th scope="row">
                        {t(row.labelKey)}
                      </th>
                      {list.map((group) => {
                        const ticks = drafts[group.id] ?? group.features;
                        return (
                          <td key={group.id} className="col-center">
                            <input
                              type="checkbox"
                              aria-label={`${group.name} · ${t(row.labelKey)}`}
                              checked={ticks.includes(row.tick)}
                              disabled={saving || lockedBy(ticks, row.tick)}
                              title={lockedBy(ticks, row.tick) ? t('featureGroups.incidentsLocked') : undefined}
                              onChange={() => setDrafts((current) => toggleTick(list, current, group.id, row.tick))}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                ))}
                <tr>
                  <td />
                  {list.map((group) => (
                    <td key={group.id} className="col-center">
                      <div className="row" style={{ gap: 'var(--space-2)', justifyContent: 'center' }}>
                        <button type="button" className="btn sm" onClick={() => setNaming(group)}>
                          {t('featureGroups.rename')}
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          disabled={group.memberCount > 0}
                          title={group.memberCount > 0 ? t('featureGroups.deleteInUse') : undefined}
                          onClick={() => void deleteGroup(group)}
                        >
                          {t('featureGroups.delete')}
                        </button>
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </ScrollX>
          {error ? (
            <p className="alert error" role="alert">
              {error}
            </p>
          ) : null}
          <StickyActionBar
            compact
            label={t('featureGroups.save')}
            note={changed.length > 0 ? t('featureGroups.dirty', { count: changed.length }) : t('featureGroups.clean')}
          >
            <button type="button" className="btn sm" disabled={changed.length === 0 || saving} onClick={() => setDrafts({})}>
              {t('featureGroups.discard')}
            </button>
            <button
              type="button"
              className="btn sm primary"
              disabled={changed.length === 0 || saving}
              onClick={() => void save()}
            >
              {saving ? t('common.working') : t('featureGroups.save')}
            </button>
          </StickyActionBar>
        </section>
      )}

      {naming ? (
        <GroupNameDialog
          me={me}
          group={naming === 'new' ? null : naming}
          onClose={() => setNaming(null)}
          onDone={(name) => {
            setNaming(null);
            void refresh();
            toast({ message: t(naming === 'new' ? 'featureGroups.created' : 'featureGroups.renamed', { name }) });
          }}
        />
      ) : null}
      {guard.blocked ? (
        <ConfirmDialog
          title={t('featureGroups.leaveTitle')}
          message={t('featureGroups.leaveMessage', { count: changed.length })}
          confirmLabel={t('featureGroups.discard')}
          cancelLabel={t('featureGroups.leaveStay')}
          danger
          onConfirm={() => {
            setDrafts({});
            guard.proceed();
          }}
          onCancel={() => guard.stay()}
        />
      ) : null}
    </>
  );
}

/** Thêm nhóm (bắt đầu với đủ bảy ô — SA bỏ tick những mục không cho) hoặc đổi tên nhóm. */
function GroupNameDialog({
  me,
  group,
  onClose,
  onDone,
}: {
  me: Me;
  group: FeatureGroup | null;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(group?.name ?? '');
  const [error, setError] = useSubmitError([name]);
  const create = useApiMutation<{ name: string; features: string[] }, { id: string }>('/api/v1/feature-groups', {
    csrfToken: me.csrfToken,
    refreshMe: false,
  });
  const rename = useApiMutation<{ name: string }, unknown>(`/api/v1/feature-groups/${group?.id ?? ''}`, {
    method: 'PATCH',
    csrfToken: me.csrfToken,
    refreshMe: false,
  });
  const busy = create.isPending || rename.isPending;
  const trimmed = name.trim();

  const submit = async () => {
    setError(null);
    try {
      if (group) await rename.mutateAsync({ name: trimmed });
      else await create.mutateAsync({ name: trimmed, features: [...FEATURE_TICKS] });
      onDone(trimmed);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={440}
      title={group ? t('featureGroups.renameTitle') : t('featureGroups.newTitle')}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="feature-group-name"
            className="btn primary"
            disabled={busy || trimmed.length === 0 || trimmed === group?.name}
          >
            {busy ? t('common.working') : t(group ? 'featureGroups.rename' : 'featureGroups.add')}
          </button>
        </>
      }
    >
      <form
        id="feature-group-name"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('featureGroups.name')} htmlFor="feature-group-name-input">
          <input
            id="feature-group-name-input"
            maxLength={60}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </form>
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
