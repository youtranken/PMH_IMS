import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { DiagramViewer } from '@/ui/diagram-viewer';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { isStepUpCancelled, useStepUpRetry } from '@/ui/use-step-up-retry';
import { TREE_KEY, contentKey, type DiagramContent, type DiagramNode } from './diagram-api';
import { slideOrder } from './diagram-tree';

/** Xin trình duyệt cho toàn màn hình — phải gọi trong cú bấm của người dùng; bị từ chối thì thôi. */
export function enterFullscreen(): void {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root || typeof root.requestFullscreen !== 'function' || document.fullscreenElement) return;
  root.requestFullscreen().catch(() => undefined);
}

function leaveFullscreen(): void {
  if (typeof document !== 'undefined' && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
    document.exitFullscreen().catch(() => undefined);
  }
}

/**
 * Trình chiếu (cho người mới): đi lần lượt bản CHÍNH THỨC từ nút đã chọn xuống các bản vẽ con,
 * toàn màn hình, ← → chuyển trang, Esc thoát. Mỗi trang tải nội dung qua route có step-up nên
 * mỗi trang là một dòng `diagram.viewed`; hết ân hạn giữa chừng thì hộp nhập mã mở NGAY trên
 * trang đang chiếu — đóng hộp không thoát trình chiếu, trang hiện nút mở khoá.
 *
 * Toàn màn hình xin cho cả `document` (không riêng khung này) để hộp nhập mã — dựng ngoài khung
 * qua portal — vẫn nằm trong vùng toàn màn hình.
 */
export function DiagramSlideshow({ me }: { me: Me }) {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stepUp = useStepUpRetry(me.csrfToken);
  const [index, setIndex] = useState(0);
  const tree = useQuery({ queryKey: TREE_KEY, queryFn: () => apiFetch<DiagramNode[]>('/api/v1/diagrams') });
  const slides = useMemo(() => slideOrder(tree.data ?? [], id), [tree.data, id]);
  const slide = slides[Math.min(index, Math.max(0, slides.length - 1))] ?? null;

  const content = useQuery({
    queryKey: contentKey(slide?.id ?? '', 'view', slide?.officialVersionId ?? null),
    queryFn: () =>
      stepUp.run(
        () =>
          apiFetch<DiagramContent>(
            `/api/v1/diagrams/${slide?.id}/content?${new URLSearchParams({ mode: 'view', versionId: slide?.officialVersionId ?? '' }).toString()}`,
          ),
        t('diagrams.screen.stepUpPurpose', { name: slide?.name ?? '' }),
      ),
    enabled: Boolean(slide?.officialVersionId),
    // Cùng lý do với màn xem: mỗi lần tải là một dòng `diagram.viewed`, không tự tải lại.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const exit = () => {
    leaveFullscreen();
    navigate(PATHS.diagrams);
  };
  const go = (delta: number) => setIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(slides.length - 1, 0)));

  /* Phím của trình chiếu tắt khi hộp nhập mã đang mở: Esc ở đó là đóng hộp, không phải thoát. */
  const dialogOpen = useRef(false);
  const keys = useRef({ exit, go });
  useEffect(() => {
    dialogOpen.current = Boolean(stepUp.dialog);
    keys.current = { exit, go };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialogOpen.current || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') keys.current.go(1);
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') keys.current.go(-1);
      else if (event.key === 'Escape') keys.current.exit();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let body;
  if (tree.isPending) body = <Loading />;
  else if (tree.isError) body = <LoadError error={tree.error} onRetry={() => void tree.refetch()} />;
  else if (!slide) body = <EmptyState title={t('diagrams.slideshow.empty')} hint={t('diagrams.slideshow.emptyHint')} />;
  else if (content.isPending) body = <Loading />;
  else if (content.isError) {
    body = isStepUpCancelled(content.error) ? (
      <EmptyState
        title={t('diagrams.screen.locked')}
        hint={t('diagrams.screen.lockedHint')}
        action={
          <button type="button" className="btn primary" onClick={() => void content.refetch()}>
            {t('diagrams.screen.unlock')}
          </button>
        }
      />
    ) : (
      <LoadError error={content.error} onRetry={() => void content.refetch()} />
    );
  } else if (!content.data.version?.svg) body = <EmptyState title={t('diagrams.screen.noVersionTitle')} hint={t('diagrams.screen.noVersionHint')} />;
  else body = <DiagramViewer key={slide.id} svg={content.data.version.svg} viewer={me} title={t('diagrams.slideshow.viewerTitle', { name: slide.name })} />;

  return (
    <section className="slideshow" aria-label={t('diagrams.slideshow.label')}>
      <div className="full-bar">
        <h1 className="full-bar-title">{slide ? slide.name : t('diagrams.slideshow.label')}</h1>
        {slides.length > 0 ? (
          <span className="muted" role="status" aria-label={t('diagrams.slideshow.progressLabel')}>
            {t('diagrams.slideshow.progress', { at: Math.min(index, slides.length - 1) + 1, total: slides.length })}
          </span>
        ) : null}
        <div className="full-bar-actions">
          <button type="button" className="btn" disabled={index <= 0} onClick={() => go(-1)}>
            {t('diagrams.slideshow.prev')}
          </button>
          <button type="button" className="btn primary" disabled={index >= slides.length - 1} onClick={() => go(1)}>
            {t('diagrams.slideshow.next')}
          </button>
          <button type="button" className="btn" onClick={exit}>
            {t('diagrams.slideshow.exit')}
          </button>
        </div>
      </div>
      <div className="full-stage">{body}</div>
      {stepUp.dialog}
    </section>
  );
}
