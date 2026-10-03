import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '@/lib/api-client';
import { errorCode, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { useConfirm } from '@/ui/confirm-provider';
import type { ViewerPin, ViewerPoint } from '@/ui/diagram-viewer';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { useDisabledReason } from '@/ui/disabled-reason';
import { Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { Popover } from '@/ui/popover';
import { useToast } from '@/ui/toast';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import {
  TREE_KEY,
  commentsKey,
  historyKey,
  nodeKey,
  publicationsKey,
  reviewKey,
  versionsKey,
  type ApprovalInfo,
  type CommentThread,
  type DiagramNode,
  type Finding,
  type ReviewPage,
} from './diagram-api';

type Run = <T>(action: () => Promise<T>, purpose: string) => Promise<T>;

/** Lỗi tự kiểm (`DIAGRAM_CHECK_FAILED`) mang danh sách đỏ/vàng — hộp hiện đủ, không chỉ câu đầu. */
export function checkFindings(error: unknown): { errors: Finding[]; warnings: Finding[] } | null {
  if (!(error instanceof ApiError) || errorCode(error) !== 'DIAGRAM_CHECK_FAILED') return null;
  const body = error.body as { errors?: Finding[]; warnings?: Finding[] } | null;
  return { errors: body?.errors ?? [], warnings: body?.warnings ?? [] };
}

/** Luồng ghim → ghim của trình xem (nhãn = lời bình đầu, cắt ngắn cho tên trợ năng). */
export function viewerPins(threads: CommentThread[]): ViewerPin[] {
  return threads
    .filter((thread) => thread.cellId || thread.anchor)
    .map((thread) => ({
      id: thread.id,
      cellId: thread.cellId,
      anchor: thread.anchor,
      label: (thread.body ?? '').slice(0, 80),
      resolved: thread.resolved,
    }));
}

function FindingList({ title, items, onGoTo }: { title: string; items: Finding[]; onGoTo?: (cellId: string) => void }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section>
      <h3>{title}</h3>
      <ul className="tree-list">
        {items.map((item, index) => (
          <li key={`${item.code}-${item.cellId ?? index}`} className="tree-row">
            <span className={item.level === 'error' ? 'badge danger' : 'badge warn'}>
              {t(item.level === 'error' ? 'diagrams.review.levelError' : 'diagrams.review.levelWarning')}
            </span>
            <span>{item.message}</span>
            {item.cellId && onGoTo ? (
              <button type="button" className="btn sm" onClick={() => onGoTo(item.cellId ?? '')}>
                {t('diagrams.review.goToCell')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Gửi duyệt / Phát hành / Duyệt / Trả về / Rút và bình luận ghim của MỘT bản vẽ (Q-23).
 *
 * Màn bản vẽ đặt `actions` lên thanh mảnh (cả chế độ Xem lẫn Sửa), `dialogs` vào cây JSX, và
 * trải `viewer` lên `DiagramViewer` ở chế độ Xem (ghim, chế độ ghim, bay tới ô).
 */
export function useDiagramReview({
  me,
  diagram,
  run,
  versionId,
  dirty,
  onGoToCell,
}: {
  me: Me;
  /** `null` khi tên bản vẽ chưa tải xong — mọi truy vấn tắt, không nút nào. */
  diagram: DiagramNode | null;
  run: Run;
  /** Phiên bản đang hiện (ghim mới gắn vào nó); `null` = chưa có nội dung. */
  versionId: string | null;
  /** Đang vẽ dở chưa lưu — gửi duyệt / phát hành áp lên bản ĐÃ LƯU nên phải lưu trước. */
  dirty: boolean;
  onGoToCell: (cellId: string) => void;
}): {
  actions: ReactNode;
  dialogs: ReactNode;
  status: ReactNode;
  review: ReviewPage | null;
  pinMode: boolean;
  togglePinMode: () => void;
  viewer: {
    pins: ViewerPin[];
    pickAnyCell: boolean;
    onPinClick: (pinId: string) => void;
    onPickCell: (cellId: string, at?: ViewerPoint | null) => void;
  };
} {
  const { t } = useTranslation();
  const toast = useToast();
  const ask = useConfirm();
  const queryClient = useQueryClient();
  const manager = me.role === 'sa' || me.role === 'admin';
  const id = diagram?.id ?? '';
  const name = diagram?.name ?? '';
  const purpose = t('diagrams.screen.stepUpPurpose', { name });
  const editPurpose = t('diagrams.screen.stepUpEdit', { name });
  const [submitOpen, setSubmitOpen] = useState(false);
  const [decideOpen, setDecideOpen] = useState(false);
  const [findings, setFindings] = useState<{ errors: Finding[]; warnings: Finding[] } | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [draftPin, setDraftPin] = useState<{ cellId: string | null; anchor: ViewerPoint | null } | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);

  const pendingId = diagram?.pendingApprovalId ?? null;
  const review = useQuery({
    queryKey: reviewKey(id),
    queryFn: () => run(() => apiFetch<ReviewPage>(`/api/v1/diagrams/${id}/review`), purpose),
    enabled: Boolean(pendingId),
    retry: false,
  });
  const comments = useQuery({
    queryKey: commentsKey(id),
    queryFn: () => run(() => apiFetch<CommentThread[]>(`/api/v1/diagrams/${id}/comments`), purpose),
    enabled: diagram !== null && versionId !== null,
    retry: false,
  });
  const threads = Array.isArray(comments.data) ? comments.data : [];
  const page = pendingId ? (review.data ?? null) : null;
  const own = Boolean(page?.approval && page.approval.requester.toLowerCase() === me.email.toLowerCase());

  const refresh = async () => {
    await Promise.all(
      [TREE_KEY, nodeKey(id), reviewKey(id), commentsKey(id), versionsKey(id), historyKey(id), publicationsKey(id)].map(
        (queryKey) => queryClient.invalidateQueries({ queryKey }),
      ),
    );
  };

  /** Lỗi chung: tự kiểm đỏ mở hộp danh sách lỗi; huỷ hộp mã thì im lặng. */
  const fail = (error: unknown) => {
    const found = checkFindings(error);
    if (found) setFindings(found);
    else if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
  };

  const post = <T,>(path: string, body?: unknown) =>
    run(
      () =>
        apiFetch<T>(`/api/v1/diagrams/${id}${path}`, {
          method: 'POST',
          csrfToken: me.csrfToken,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      editPurpose,
    );

  const publish = async () => {
    const seq = diagram?.latestVersion?.seq ?? 0;
    const ok = await ask({
      title: t('diagrams.review.publishTitle', { seq }),
      message: t('diagrams.review.publishMessage'),
      confirmLabel: t('diagrams.review.publish'),
    });
    if (!ok) return;
    try {
      const result = await post<{ seq: number; warnings: Finding[] }>('/publish', {});
      await refresh();
      toast({
        tone: 'ok',
        message: result.warnings.length
          ? t('diagrams.review.publishedWarnings', { seq: result.seq, count: result.warnings.length })
          : t('diagrams.review.published', { seq: result.seq }),
      });
    } catch (error) {
      fail(error);
    }
  };

  const withdraw = async () => {
    if (!pendingId) return;
    const ok = await ask({
      title: t('diagrams.review.withdrawTitle'),
      message: t('diagrams.review.withdrawMessage'),
      confirmLabel: t('diagrams.review.withdraw'),
    });
    if (!ok) return;
    try {
      await post(`/review/${pendingId}/withdraw`);
      await refresh();
      toast({ tone: 'ok', message: t('diagrams.review.withdrawn') });
    } catch (error) {
      fail(error);
    }
  };

  const canSend = Boolean(diagram?.latestVersion) && !pendingId && diagram?.status !== 'official' && diagram?.kind === 'official';
  const sendReason = dirty ? t('diagrams.review.saveFirst') : null;
  const sendHint = useDisabledReason(sendReason);

  const actions = !diagram ? null : (
    <>
      {pendingId ? <span className="badge warn">{t('diagrams.status.pending')}</span> : null}
      {canSend ? (
        <button type="button" className="btn" disabled={Boolean(sendReason)} {...sendHint.buttonProps} onClick={() => setSubmitOpen(true)}>
          {t('diagrams.review.submit')}
        </button>
      ) : null}
      {canSend && manager ? (
        <button type="button" className="btn" disabled={Boolean(sendReason)} {...sendHint.buttonProps} onClick={() => void publish()}>
          {t('diagrams.review.publish')}
        </button>
      ) : null}
      {sendHint.hint}
      {pendingId && page && own ? (
        <button type="button" className="btn" onClick={() => void withdraw()}>
          {t('diagrams.review.withdraw')}
        </button>
      ) : null}
      {pendingId && page && manager && !own ? (
        <button type="button" className="btn primary" onClick={() => setDecideOpen(true)}>
          {t('diagrams.review.decide')}
        </button>
      ) : null}
      <Popover label={t('diagrams.review.pins', { count: threads.length })} title={t('diagrams.review.pinsTitle')} open={pinsOpen} onOpenChange={setPinsOpen}>
        <PinList
          threads={threads}
          loading={comments.isPending && versionId !== null}
          onOpen={(thread) => {
            setPinsOpen(false);
            setOpenThread(thread.id);
            if (thread.cellId) onGoToCell(thread.cellId);
          }}
          onAddGeneral={() => {
            setPinsOpen(false);
            setDraftPin({ cellId: null, anchor: null });
          }}
          canAdd={versionId !== null}
        />
      </Popover>
    </>
  );

  const status =
    pendingId && review.isError ? (
      <p className="muted" role="status">
        {t('diagrams.review.loadFailed')}
      </p>
    ) : null;

  const thread = openThread ? threads.find((x) => x.id === openThread) : undefined;
  const dialogs = (
    <>
      {submitOpen && diagram ? (
        <SubmitDialog
          diagram={diagram}
          post={post}
          onDone={async (warnings) => {
            setSubmitOpen(false);
            await refresh();
            toast({
              tone: 'ok',
              message: warnings.length ? t('diagrams.review.submittedWarnings', { count: warnings.length }) : t('diagrams.review.submitted'),
            });
          }}
          onFindings={(found) => {
            setSubmitOpen(false);
            setFindings(found);
          }}
          onClose={() => setSubmitOpen(false)}
        />
      ) : null}
      {decideOpen && page?.approval ? (
        <DecideDialog
          page={page}
          approval={page.approval}
          post={post}
          pinned={threads.filter((x) => x.approvalId === page.approval?.id).length}
          onGoTo={(cellId) => {
            setDecideOpen(false);
            onGoToCell(cellId);
          }}
          onStartPinning={() => {
            setDecideOpen(false);
            setPinMode(true);
          }}
          onDone={async (message) => {
            setDecideOpen(false);
            await refresh();
            toast({ tone: 'ok', message });
          }}
          onFail={(error) => {
            setDecideOpen(false);
            fail(error);
          }}
          onClose={() => setDecideOpen(false)}
        />
      ) : null}
      {findings ? (
        <Dialog open onOpenChange={() => setFindings(null)} maxWidth={620} initialFocus="title" title={t('diagrams.review.checkFailedTitle')}>
          <p>{t('diagrams.review.checkFailedHint')}</p>
          <FindingList
            title={t('diagrams.review.errors')}
            items={findings.errors}
            onGoTo={(cellId) => {
              setFindings(null);
              onGoToCell(cellId);
            }}
          />
          <FindingList title={t('diagrams.review.warnings')} items={findings.warnings} />
        </Dialog>
      ) : null}
      {draftPin && versionId ? (
        <NewPinDialog
          cellId={draftPin.cellId}
          onSubmit={async (body) => {
            await post('/comments', { versionId, cellId: draftPin.cellId, anchor: draftPin.anchor, body });
            setDraftPin(null);
            setPinMode(false);
            await queryClient.invalidateQueries({ queryKey: commentsKey(id) });
            toast({ tone: 'ok', message: t('diagrams.review.pinned') });
          }}
          onClose={() => setDraftPin(null)}
        />
      ) : null}
      {thread ? (
        <ThreadDialog
          thread={thread}
          onReply={async (body) => {
            await post('/comments', { versionId: thread.versionId, parentId: thread.id, body });
            await queryClient.invalidateQueries({ queryKey: commentsKey(id) });
          }}
          onResolve={async (resolved) => {
            await post(`/comments/${thread.id}/resolve`, { resolved });
            await queryClient.invalidateQueries({ queryKey: commentsKey(id) });
          }}
          onClose={() => setOpenThread(null)}
        />
      ) : null}
    </>
  );

  return {
    actions,
    dialogs,
    status,
    review: page,
    pinMode,
    togglePinMode: () => setPinMode((on) => !on),
    viewer: {
      pins: viewerPins(threads),
      pickAnyCell: pinMode,
      onPinClick: (pinId) => setOpenThread(pinId),
      onPickCell: (cellId, at) => setDraftPin({ cellId, anchor: at ?? null }),
    },
  };
}

/** Nút bật/tắt chế độ ghim — chỉ ở chế độ Xem (bấm hình trên ảnh xem để ghim). */
export function PinModeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className={active ? 'btn primary' : 'btn'} aria-pressed={active} onClick={onToggle}>
      {active ? t('diagrams.review.pinModeOn') : t('diagrams.review.pinMode')}
    </button>
  );
}

function PinList({
  threads,
  loading,
  canAdd,
  onOpen,
  onAddGeneral,
}: {
  threads: CommentThread[];
  loading: boolean;
  canAdd: boolean;
  onOpen: (thread: CommentThread) => void;
  onAddGeneral: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      {loading ? <Loading /> : null}
      {!loading && threads.length === 0 ? <p className="muted">{t('diagrams.review.pinsEmpty')}</p> : null}
      {threads.length > 0 ? (
        <ul className="tree-list" aria-label={t('diagrams.review.pinsTitle')}>
          {threads.map((thread, index) => (
            <li key={thread.id} className="tree-row">
              <button type="button" className="btn sm" onClick={() => onOpen(thread)}>
                {t('diagrams.review.pinItem', { n: index + 1, body: (thread.body ?? '').slice(0, 60) })}
              </button>{' '}
              {thread.resolved ? <span className="badge ok">{t('diagrams.review.resolved')}</span> : null}{' '}
              <span className="muted">
                {thread.cellId ? t('diagrams.review.onCell', { cell: thread.cellId }) : t('diagrams.review.general')}
                {thread.versionSeq ? ` · ${t('diagrams.versions.seq', { seq: thread.versionSeq })}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {canAdd ? (
        <button type="button" className="btn sm" onClick={onAddGeneral}>
          {t('diagrams.review.addGeneral')}
        </button>
      ) : null}
    </div>
  );
}

function TextDialog({
  title,
  intro,
  label,
  submitLabel,
  required = true,
  maxLength,
  children,
  onSubmit,
  onClose,
}: {
  title: string;
  intro?: ReactNode;
  label: string;
  submitLabel: string;
  required?: boolean;
  maxLength: number;
  children?: ReactNode;
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const submit = async () => {
    if (required && !text.trim()) {
      setMissing(true);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(text.trim());
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      guardUnsaved
      maxWidth={520}
      initialFocus="first-field"
      title={title}
      footer={
        <>
          <DialogCancel>{t('diagrams.form.cancel')}</DialogCancel>
          <button type="submit" form="diagram-review-text" className="btn primary" disabled={busy}>
            {submitLabel}
          </button>
        </>
      }
    >
      {intro}
      <form
        id="diagram-review-text"
        className="form-grid"
        data-columns={1}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={label} required={required} htmlFor="diagram-review-text-field" error={missing ? t('diagrams.review.textRequired') : null}>
          <textarea
            id="diagram-review-text-field"
            className="inp"
            rows={3}
            maxLength={maxLength}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setMissing(false);
            }}
          />
        </Field>
      </form>
      {children}
    </Dialog>
  );
}

function SubmitDialog({
  diagram,
  post,
  onDone,
  onFindings,
  onClose,
}: {
  diagram: DiagramNode;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  onDone: (warnings: Finding[]) => Promise<void>;
  onFindings: (found: { errors: Finding[]; warnings: Finding[] }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TextDialog
      title={t('diagrams.review.submitTitle', { name: diagram.name })}
      intro={<p>{t('diagrams.review.submitIntro', { seq: diagram.latestVersion?.seq ?? 0 })}</p>}
      label={t('diagrams.review.reason')}
      submitLabel={t('diagrams.review.send')}
      maxLength={500}
      onSubmit={async (reason) => {
        try {
          const result = await post<{ warnings: Finding[] }>('/submit', { reason });
          await onDone(result.warnings);
        } catch (error) {
          const found = checkFindings(error);
          if (found) onFindings(found);
          else throw error;
        }
      }}
      onClose={onClose}
    />
  );
}

function DecideDialog({
  page,
  approval,
  post,
  pinned,
  onGoTo,
  onStartPinning,
  onDone,
  onFail,
  onClose,
}: {
  page: ReviewPage;
  approval: ApprovalInfo;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  pinned: number;
  onGoTo: (cellId: string) => void;
  onStartPinning: () => void;
  onDone: (message: string) => Promise<void>;
  onFail: (error: unknown) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const compare = useDisabledReason(t('diagrams.review.compareLater'), { visible: true });
  const decide = async (to: 'approve' | 'return') => {
    setBusy(true);
    try {
      await post(`/review/${approval.id}/${to}`, { note: note.trim() || null });
      await onDone(to === 'approve' ? t('diagrams.review.approved', { seq: page.seq }) : t('diagrams.review.returned'));
    } catch (error) {
      onFail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={640}
      initialFocus="title"
      title={t('diagrams.review.decideTitle', { seq: page.seq })}
      footer={
        <>
          <DialogCancel>{t('diagrams.form.cancel')}</DialogCancel>
          <button type="button" className="btn" disabled={busy} onClick={() => void decide('return')}>
            {t('diagrams.review.return')}
          </button>
          <button type="button" className="btn primary" disabled={busy || page.errors.length > 0} onClick={() => void decide('approve')}>
            {t('diagrams.review.approve')}
          </button>
        </>
      }
    >
      <p>
        {t('diagrams.review.requestedBy', { name: approval.requesterName, seq: page.seq, at: formatDateTime(approval.createdAt) })}
      </p>
      <dl>
        <div>
          <dt>{t('diagrams.review.reason')}</dt>
          <dd>{approval.reason}</dd>
        </div>
        <div>
          <dt>{page.officialSeq ? t('diagrams.review.summaryVs', { seq: page.officialSeq }) : t('diagrams.review.summaryFirst')}</dt>
          <dd>{page.summary}</dd>
        </div>
      </dl>
      <p className="row">
        <button type="button" className="btn sm" disabled {...compare.buttonProps}>
          {t('diagrams.review.compare')}
        </button>
        {compare.hint}
      </p>
      <FindingList title={t('diagrams.review.errors')} items={page.errors} onGoTo={onGoTo} />
      <FindingList title={t('diagrams.review.warnings')} items={page.warnings} onGoTo={onGoTo} />
      {page.errors.length === 0 && page.warnings.length === 0 ? <p className="muted">{t('diagrams.review.noFindings')}</p> : null}
      <p className="row">
        <span className="muted">{t('diagrams.review.pinnedCount', { count: pinned })}</span>
        <button type="button" className="btn sm" onClick={onStartPinning}>
          {t('diagrams.review.pinMode')}
        </button>
      </p>
      <Field label={t('diagrams.review.note')} hint={t('diagrams.review.noteHint')} htmlFor="diagram-decide-note">
        <textarea id="diagram-decide-note" className="inp" rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </Dialog>
  );
}

function NewPinDialog({
  cellId,
  onSubmit,
  onClose,
}: {
  cellId: string | null;
  onSubmit: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TextDialog
      title={cellId ? t('diagrams.review.pinTitle', { cell: cellId }) : t('diagrams.review.generalTitle')}
      label={t('diagrams.review.comment')}
      submitLabel={t('diagrams.review.pinPost')}
      maxLength={2000}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
}

function ThreadDialog({
  thread,
  onReply,
  onResolve,
  onClose,
}: {
  thread: CommentThread;
  onReply: (body: string) => Promise<void>;
  onResolve: (resolved: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await onResolve(!thread.resolved);
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  const line = (row: { authorName: string | null; author: string; createdAt: string }) =>
    t('diagrams.review.byAt', { by: row.authorName ?? row.author, at: formatDateTime(row.createdAt) });
  if (replying) {
    return (
      <TextDialog
        title={t('diagrams.review.replyTitle')}
        label={t('diagrams.review.comment')}
        submitLabel={t('diagrams.review.reply')}
        maxLength={2000}
        onSubmit={async (body) => {
          await onReply(body);
          setReplying(false);
        }}
        onClose={() => setReplying(false)}
      />
    );
  }
  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={560}
      initialFocus="title"
      title={thread.cellId ? t('diagrams.review.threadTitle', { cell: thread.cellId }) : t('diagrams.review.general')}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={() => void toggle()}>
            {thread.resolved ? t('diagrams.review.reopen') : t('diagrams.review.resolve')}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => setReplying(true)}>
            {t('diagrams.review.reply')}
          </button>
        </>
      }
    >
      {thread.resolved ? <p className="badge ok">{t('diagrams.review.resolved')}</p> : null}
      <ul className="tree-list" aria-label={t('diagrams.review.threadLabel')}>
        {[thread, ...thread.replies].map((row) => (
          <li key={row.id} className="tree-row">
            <p className="muted">{line(row)}</p>
            <p>{row.body}</p>
          </li>
        ))}
      </ul>
      {thread.versionSeq ? <p className="muted">{t('diagrams.review.pinnedOn', { seq: thread.versionSeq })}</p> : null}
    </Dialog>
  );
}

