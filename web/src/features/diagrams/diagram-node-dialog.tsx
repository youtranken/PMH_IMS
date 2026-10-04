import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select, type SelectOption } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { NODE_TYPES, NODE_TYPE_KEY, TREE_KEY, nodeKey, type DiagramNode, type DiagramNodeType } from './diagram-api';
import { pathOf, subtreeIds } from './diagram-tree';

const ROOT = '__root__';
const NONE = '__none__';

/**
 * Tạo bản vẽ (con của `parent`, hoặc gốc cây) hoặc sửa một nút (`node`). Chuyển nhánh chỉ có ở
 * chế độ sửa — vai được sửa do nơi mở hộp quyết, API vẫn chặn (`@Roles` + quyền theo bản vẽ).
 * Bản trình bày chỉ đổi tên: nó đứng ngoài cây, và Thành viên chủ của nó chỉ được đổi tên.
 *
 * Bản vẽ con mặc định NHÂN BẢN nội dung mới nhất của bản cha (Q-23): tầng/phòng thường vẽ tiếp từ
 * bản cha. Nhân bản đi `run` vì nó chép nội dung bản vẽ (đòi mã sơ đồ như khi xem).
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
  /** `useStepUpRetry().run` của màn — chỉ cần khi tạo bản vẽ con kiểu nhân bản. */
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
    nodeType: (node?.nodeType ?? (parent ? 'floor' : 'company')) as DiagramNodeType,
    parentId: node?.parentId ?? parent?.id ?? null,
    siteId: node?.siteId ?? null,
    cabinetId: node?.cabinetId ?? null,
  });
  const [nameError, setNameError] = useState<string | null>(null);
  const copySeq = !node && parent ? (parent.latestVersion?.seq ?? null) : null;
  const [start, setStart] = useState<'copy' | 'blank'>(copySeq ? 'copy' : 'blank');
  const [copying, setCopying] = useState(false);

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

  const copyChild = async (from: DiagramNode) => {
    setCopying(true);
    try {
      const { parentId: _parent, ...rest } = form;
      const body = JSON.stringify(Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null && value !== '')));
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

  const submit = () => {
    if (!form.name.trim()) {
      setNameError(t('diagrams.form.nameRequired'));
      return;
    }
    if (parent && copySeq && start === 'copy') {
      void copyChild(parent);
      return;
    }
    save.mutate(form, {
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
        {parent && !node ? (
          <Field label={t('diagrams.form.start')} hint={copySeq ? t('diagrams.form.startCopyHint') : t('diagrams.form.startParentEmpty')}>
            <div className="segmented" role="radiogroup" aria-label={t('diagrams.form.start')}>
              <label>
                <input type="radio" name="diagram-start" value="copy" disabled={!copySeq} checked={start === 'copy'} onChange={() => setStart('copy')} />
                {copySeq ? t('diagrams.form.startCopyOf', { seq: copySeq }) : t('diagrams.form.startCopy')}
              </label>
              <label>
                <input type="radio" name="diagram-start" value="blank" checked={start === 'blank'} onChange={() => setStart('blank')} />
                {t('diagrams.form.startBlank')}
              </label>
            </div>
          </Field>
        ) : null}
        {renameOnly ? null : (
          <>
            <Field label={t('diagrams.form.nodeType')}>
              <Select
                value={form.nodeType}
                ariaLabel={t('diagrams.form.nodeType')}
                options={NODE_TYPES.map((type) => ({ value: type, label: t(NODE_TYPE_KEY[type]) }))}
                onChange={(value) => setForm({ ...form, nodeType: value as DiagramNodeType })}
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
                  ...activeOptions(lists.data?.sites, node?.siteId, (site) => `${site.code} — ${site.name}`),
                ]}
                onChange={(value) => setForm({ ...form, siteId: value === NONE ? null : value, cabinetId: null })}
              />
            </Field>
            <Field label={t('diagrams.form.cabinet')}>
              <Select
                value={form.cabinetId ?? NONE}
                ariaLabel={t('diagrams.form.cabinet')}
                failed={lists.isError}
                options={[{ value: NONE, label: t('diagrams.form.none') }, ...activeOptions(cabinets, node?.cabinetId, (cab) => cab.code)]}
                onChange={(value) => setForm({ ...form, cabinetId: value === NONE ? null : value })}
              />
            </Field>
          </>
        )}
      </form>
    </Dialog>
  );
}
