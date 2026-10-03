import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { postForDownload } from '@/lib/download-file';
import { formatDate, todayIso } from '@/lib/format';
import type { Me } from '@/lib/me';
import { daysBetweenIso } from '@/lib/period-range';
import { LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { Popover } from '@/ui/popover';
import { useToast } from '@/ui/toast';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import { publicationsKey, type DiagramNode, type Publications } from './diagram-api';
import { dayAt, daySpan, officialOn, type PublicationEvent } from './diagram-timeline';

type Run = <T>(action: () => Promise<T>, purpose: string) => Promise<T>;

/**
 * "Xuất" trên thanh mảnh: PNG/PDF của phiên bản ĐANG XEM, server dựng từ ảnh đã lưu kèm chân trang
 * và watermark người xuất (FR-044). Đòi mã phạm vi sơ đồ — hết ân hạn thì hỏi mã tại chỗ; huỷ thì
 * không có file, không có dòng nhật ký.
 */
export function ExportMenu({ me, diagram, versionId, run }: { me: Me; diagram: DiagramNode; versionId: string; run: Run }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const exportAs = async (format: 'png' | 'pdf') => {
    setBusy(true);
    try {
      await run(
        () => postForDownload(`/api/v1/diagrams/${diagram.id}/versions/${versionId}/exports`, { format }, me.csrfToken, `${diagram.name}.${format}`),
        t('diagrams.tools.stepUpExport', { name: diagram.name }),
      );
      setOpen(false);
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover label={t('diagrams.tools.export')} title={t('diagrams.tools.exportTitle')} open={open} onOpenChange={setOpen}>
      <p className="muted">{t('diagrams.tools.exportHint')}</p>
      <p className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void exportAs('png')}>
          {t('diagrams.tools.exportPng')}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void exportAs('pdf')}>
          {t('diagrams.tools.exportPdf')}
        </button>
      </p>
    </Popover>
  );
}

/**
 * Thanh trượt thời gian: kéo về một ngày → bản CHÍNH THỨC hiệu lực ngày đó (từ sự kiện phát hành,
 * Q-23). Màn đổi sang xem phiên bản đó — mỗi lần đổi phiên bản là một lượt tải nội dung, có dòng
 * `diagram.viewed`.
 */
export function TimelineMenu({
  diagram,
  run,
  day,
  onPick,
  open,
  onOpenChange,
}: {
  diagram: DiagramNode;
  run: Run;
  /** Ngày đang chọn (YYYY-MM-DD); `null` = chưa kéo. */
  day: string | null;
  onPick: (day: string, official: PublicationEvent | null) => void;
  /**
   * Trạng thái mở do màn giữ: mỗi nấc kéo đổi phiên bản, màn dựng lại thanh trên trong lúc tải —
   * hộp giữ trạng thái riêng thì sập sau nấc kéo đầu tiên.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const publications = useQuery({
    queryKey: publicationsKey(diagram.id),
    queryFn: () =>
      run(() => apiFetch<Publications>(`/api/v1/diagrams/${diagram.id}/publications`), t('diagrams.screen.stepUpPurpose', { name: diagram.name })),
    enabled: open,
    retry: false,
  });
  const today = todayIso();
  const events = publications.data?.events ?? [];
  const span = daySpan(events, today);
  const current = day ?? today;
  const index = Math.min(span.days, Math.max(0, daysBetweenIso(span.from, current)));
  const hit = officialOn(events, current);

  let body;
  if (publications.isPending) body = <Loading />;
  else if (publications.isError) body = <LoadError error={publications.error} onRetry={() => void publications.refetch()} />;
  else if (events.length === 0) body = <p className="muted">{t('diagrams.tools.timelineEmpty')}</p>;
  else {
    body = (
      <>
        <Field label={t('diagrams.tools.timelineDay', { date: formatDate(current) })} htmlFor="diagram-timeline-day">
          <input
            id="diagram-timeline-day"
            type="range"
            className="inp-range"
            min={0}
            max={span.days}
            step={1}
            value={index}
            aria-label={t('diagrams.tools.timelineSlider')}
            aria-valuetext={formatDate(current)}
            onChange={(event) => {
              const next = dayAt(span.from, Number(event.target.value));
              onPick(next, officialOn(events, next));
            }}
          />
        </Field>
        <p role="status">
          {hit ? t('diagrams.tools.timelineHit', { date: formatDate(current), seq: hit.seq }) : t('diagrams.tools.timelineNone')}
        </p>
      </>
    );
  }
  return (
    <Popover label={t('diagrams.tools.timeline')} title={t('diagrams.tools.timelineTitle')} open={open} onOpenChange={onOpenChange}>
      {body}
    </Popover>
  );
}
