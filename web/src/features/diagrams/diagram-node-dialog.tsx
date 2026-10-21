import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { useDisabledReason } from '@/ui/disabled-reason';
import { Field } from '@/ui/page-header';
import { Select, type SelectOption } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import { activeOptions, siteFormLabel, useCatalogLists } from '@/ui/use-catalog-lists';
import { formatDateTime } from '@/lib/format';
import { NODE_TYPES, NODE_TYPE_KEY, TREE_KEY, nodeKey, type DiagramNode, type DiagramNodeType, type Publications, type VersionItem } from './diagram-api';
import { copySources, type CopySource } from './diagram-copy-source';
import { childNodeType, effectiveStart, startChoices, type DiagramStart } from './diagram-start';
import { pathOf, subtreeIds } from './diagram-tree';

const ROOT = '__root__';
const NONE = '__none__';
const START_LABEL: Record<DiagramStart, string> = {
  stock: 'diagrams.form.startStock',
  blank: 'diagrams.form.startBlank',
  copy: 'diagrams.form.startCopy',
};
const START_HINT: Record<DiagramStart, string> = {
  stock: 'diagrams.form.startStockHint',
  blank: 'diagrams.form.startBlankHint',
  copy: 'diagrams.form.startCopyHint',
};

/**
 * Tạo bản vẽ (con của `parent`, hoặc gốc cây) hoặc sửa một nút (`node`). Chuyển nhánh chỉ có ở
 * chế độ sửa — vai được sửa do nơi mở hộp quyết, API vẫn chặn (`@Roles` + quyền theo bản vẽ).
 * Bản trình bày chỉ đổi tên: nó đứng ngoài cây, và Thành viên chủ của nó chỉ được đổi tên.
 *
 * "Bắt đầu từ" (Q-23, luật ở `diagram-start.ts`): không gì tự chép mà người dùng không
 * bấm. Chép bản cha và dựng từ kho đi `run` vì chúng đọc/ghi NỘI DUNG bản vẽ (đòi mã sơ đồ).
 */
export function DiagramNodeDialog({
  me,
  nodes,
  parent,
  node,
  run,
  onClose,
  onSaved,
}: {
  me: Me;
  nodes: DiagramNode[];
  parent?: DiagramNode | null;
  node?: DiagramNode | null;
  /** `useStepUpRetry().run` của màn — cần khi tạo kiểu chép bản cha hay dựng từ kho. */
  run?: <T>(action: () => Promise<T>, purpose: string) => Promise<T>;
  onClose: () => void;
  /** Sau khi lưu xong (`created` = vừa tạo mới) — màn cây chọn nút vừa tạo để thẻ của nó hiện ra. */
  onSaved?: (saved: DiagramNode, created: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const lists = useCatalogLists();
  const editing = Boolean(node);
  const renameOnly = node?.kind === 'presentation';
  const [form, setForm] = useState({
    name: node?.name ?? '',
    nodeType: node?.nodeType ?? childNodeType(parent?.nodeType ?? null),
    parentId: node?.parentId ?? parent?.id ?? null,
    // Bản vẽ con thường cùng site với bản cha (D-03): điền sẵn, người vẽ đổi được.
    siteId: node ? node.siteId : (parent?.siteId ?? null),
    cabinetId: node?.cabinetId ?? null,
  });
  // Tủ chỉ gắn vào bản vẽ cấp tủ (D-03, server cũng chặn): cấp khác thì không hỏi, không gửi.
  const cabinetLevel = form.nodeType === 'cabinet';
  const [nameError, setNameError] = useState<string | null>(null);
  const copySeq = !node && parent ? (parent.latestVersion?.seq ?? null) : null;
  const startState = startChoices({
    hasParent: Boolean(parent) && !node,
    parentHasContent: Boolean(copySeq),
    cabinetLevel,
    cabinetPicked: Boolean(form.cabinetId),
  });
  const [picked, setPicked] = useState<DiagramStart | null>(null);
  const start = effectiveStart(picked, startState);
  const reasonOf = (value: DiagramStart) => startState.choices.find((c) => c.value === value)?.disabledReason ?? null;
  const stockOff = useDisabledReason(reasonOf('stock') ? t(`diagrams.form.startOff_${reasonOf('stock')}`) : null, { visible: true });
  const copyOff = useDisabledReason(reasonOf('copy') ? t(`diagrams.form.startOff_${reasonOf('copy')}`) : null, { visible: true });
  const [copying, setCopying] = useState(false);
  /* Danh sách đầy đủ là nội dung bản vẽ (hỏi mã) — chỉ tải khi người dùng bấm "Chọn phiên bản khác…". */
  const [history, setHistory] = useState<{ versions: VersionItem[]; published: string[] } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const sources = parent && !node ? copySources(parent, history?.versions, history?.published) : [];
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');

  const save = useApiMutation<typeof form, DiagramNode>(node ? `/api/v1/diagrams/${node.id}` : '/api/v1/diagrams', {
    method: editing ? 'PATCH' : 'POST',
    csrfToken: me.csrfToken,
    refreshMe: false,
    body: (input) =>
      editing
        ? renameOnly
          ? { name: input.name }
          : input
        : Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== '')),
  });

  const busy = save.isPending || copying;

  const parentOptions = useMemo<SelectOption[]>(() => {
    const blocked = node ? subtreeIds(nodes, node.id) : new Set<string>();
    return [
      { value: ROOT, label: t('diagrams.form.root') },
      ...nodes
        .filter((n) => !blocked.has(n.id))
        .map((n) => ({ value: n.id, label: pathOf(nodes, n.id).map((p) => p.name).join(' / ') })),
    ];
  }, [nodes, node, t]);

  const done = async (saved: DiagramNode, message: string) => {
    await queryClient.invalidateQueries({ queryKey: TREE_KEY });
    await queryClient.invalidateQueries({ queryKey: nodeKey(saved.id) });
    toast({ tone: 'ok', message });
    onSaved?.(saved, !editing);
    onClose();
  };

  const loadHistory = async (from: DiagramNode) => {
    setLoadingHistory(true);
    try {
      const [versions, publications] = await (run ?? ((action) => action()))(
        () =>
          Promise.all([
            apiFetch<VersionItem[]>(`/api/v1/diagrams/${from.id}/versions`),
            apiFetch<Publications>(`/api/v1/diagrams/${from.id}/publications`),
          ]),
        t('diagrams.form.copyStepUp', { name: from.name }),
      );
      setHistory({ versions, published: publications.publishedVersionIds });
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setLoadingHistory(false);
    }
  };

  const sourceLabel = (source: CopySource) => {
    const tag = t(`diagrams.form.copyTag_${source.tag}`);
    const head = source.label ? `#${source.seq} · ${source.label}` : `#${source.seq}`;
    return [head, tag, source.summary, source.savedAt ? formatDateTime(source.savedAt) : null].filter(Boolean).join(' · ');
  };

  const copyChild = async (from: DiagramNode) => {
    setCopying(true);
    try {
      const { parentId: _parent, ...rest } = cabinetLevel ? form : { ...form, cabinetId: null };
      const body = JSON.stringify({
        ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null && value !== '')),
        ...(sourceId ? { versionId: sourceId } : {}),
      });
      const saved = await (run ?? ((action) => action()))(
        () =>
          apiFetch<DiagramNode & { copiedFromSeq: number }>(`/api/v1/diagrams/${from.id}/copied-children`, {
            method: 'POST',
            csrfToken: me.csrfToken,
            body,
          }),
        t('diagrams.form.copyStepUp', { name: from.name }),
      );
      // Số phiên bản theo server: cây đang giữ có thể cũ hơn bản cha thật lúc nhân bản.
      await done(saved, t('diagrams.form.createdCopy', { name: saved.name, parent: from.name, seq: saved.copiedFromSeq }));
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setCopying(false);
    }
  };

  const buildFromStock = async () => {
    setCopying(true);
    try {
      const body = JSON.stringify(Object.fromEntries(Object.entries(form).filter(([, value]) => value !== null && value !== '')));
      const saved = await (run ?? ((action) => action()))(
        () => apiFetch<DiagramNode>('/api/v1/diagrams/from-stock', { method: 'POST', csrfToken: me.csrfToken, body }),
        t('diagrams.form.stockStepUp', { name: form.name.trim() }),
      );
      await done(saved, t('diagrams.form.createdStock', { name: saved.name }));
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setCopying(false);
    }
  };

  const submit = () => {
    if (!form.name.trim()) {
      setNameError(t('diagrams.form.nameRequired'));
      return;
    }
    if (!editing && start === 'stock') {
      void buildFromStock();
      return;
    }
    if (!editing && parent && start === 'copy') {
      void copyChild(parent);
      return;
    }
    save.mutate(cabinetLevel ? form : { ...form, cabinetId: null }, {
      onSuccess: (saved) => done(saved, t(editing ? 'diagrams.updated' : 'diagrams.created', { name: saved.name })),
      onError: (error) => toast({ tone: 'error', message: errorMessage(error) }),
    });
  };

  const cabinets = (lists.data?.cabinets ?? []).filter((c) => !form.siteId || c.siteId === form.siteId);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      guardUnsaved
      maxWidth={520}
      initialFocus="first-field"
      title={
        node
          ? t(renameOnly ? 'diagrams.presentation.renameOf' : 'diagrams.editOf', { name: node.name })
          : parent
            ? t('diagrams.addChildOf', { name: parent.name })
            : t('diagrams.add')
      }
      footer={
        <>
          <DialogCancel>{t('diagrams.form.cancel')}</DialogCancel>
          <button type="submit" form="diagram-node-form" className="btn primary" disabled={busy}>
            {t('diagrams.form.save')}
          </button>
        </>
      }
    >
      <form
        id="diagram-node-form"
        className="form-grid"
        data-columns={1}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={t('diagrams.form.name')} required hint={t('diagrams.form.nameHint')} error={nameError}>
          <input
            className="inp"
            required
            value={form.name}
            maxLength={120}
            onChange={(event) => {
              setNameError(null);
              setForm({ ...form, name: event.target.value });
            }}
          />
        </Field>
        {renameOnly ? null : (
          <>
            <Field label={t('diagrams.form.nodeType')} hint={t('diagrams.form.nodeTypeHint')}>
              <Select
                value={form.nodeType}
                ariaLabel={t('diagrams.form.nodeType')}
                options={NODE_TYPES.map((type) => ({ value: type, label: t(NODE_TYPE_KEY[type]) }))}
                onChange={(value) => setForm({ ...form, nodeType: value as DiagramNodeType, cabinetId: value === 'cabinet' ? form.cabinetId : null })}
              />
            </Field>
            {editing ? (
              <Field label={t('diagrams.form.parent')}>
                <Select
                  value={form.parentId ?? ROOT}
                  ariaLabel={t('diagrams.form.parent')}
                  searchable
                  options={parentOptions}
                  onChange={(value) => setForm({ ...form, parentId: value === ROOT ? null : value })}
                />
              </Field>
            ) : null}
            <Field label={t('diagrams.form.site')}>
              <Select
                value={form.siteId ?? NONE}
                ariaLabel={t('diagrams.form.site')}
                failed={lists.isError}
                options={[
                  { value: NONE, label: t('diagrams.form.none') },
                  ...activeOptions(lists.data?.sites, node?.siteId, siteFormLabel),
                ]}
                onChange={(value) => setForm({ ...form, siteId: value === NONE ? null : value, cabinetId: null })}
              />
            </Field>
            {cabinetLevel ? (
              <Field label={t('diagrams.form.cabinet')} hint={t('diagrams.form.cabinetHint')}>
                <Select
                  value={form.cabinetId ?? NONE}
                  ariaLabel={t('diagrams.form.cabinet')}
                  failed={lists.isError}
                  options={[{ value: NONE, label: t('diagrams.form.none') }, ...activeOptions(cabinets, node?.cabinetId, (cab) => cab.code)]}
                  onChange={(value) => setForm({ ...form, cabinetId: value === NONE ? null : value })}
                />
              </Field>
            ) : null}
          </>
        )}
        {!node && startState.choices.length > 1 ? (
          <Field label={t('diagrams.form.start')} hint={t(START_HINT[start])}>
            <div className="segmented" role="radiogroup" aria-label={t('diagrams.form.start')}>
              {startState.choices.map((choice) => {
                const off = choice.value === 'stock' ? stockOff : choice.value === 'copy' ? copyOff : null;
                return (
                  <label key={choice.value}>
                    <input
                      type="radio"
                      name="diagram-start"
                      value={choice.value}
                      disabled={Boolean(choice.disabledReason)}
                      checked={start === choice.value}
                      onChange={() => setPicked(choice.value)}
                      {...(off?.buttonProps ?? {})}
                    />
                    {t(START_LABEL[choice.value])}
                  </label>
                );
              })}
            </div>
            {stockOff.hint}
            {copyOff.hint}
          </Field>
        ) : null}
        {parent && !node && start === 'copy' ? (
          <Field label={t('diagrams.form.copyVersion')} hint={history ? t('diagrams.form.copyVersionAllHint') : t('diagrams.form.copyVersionHint')}>
            <Select
              value={sourceId}
              ariaLabel={t('diagrams.form.copyVersion')}
              options={sources.map((source) => ({ value: source.id, label: sourceLabel(source) }))}
              onChange={setSourceId}
            />
            {history ? null : (
              <button type="button" className="linkbtn" disabled={loadingHistory} onClick={() => void loadHistory(parent)}>
                {t('diagrams.form.copyVersionMore')}
              </button>
            )}
          </Field>
        ) : null}
      </form>
    </Dialog>
  );
}
