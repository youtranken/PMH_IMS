import { useTranslation } from 'react-i18next';
import { Dialog } from '@/ui/dialog';
import { StepList } from '@/ui/step-list';

/** Hộp "Hướng dẫn" mở từ menu ⋮ của thanh sơ đồ: mỗi khái niệm một đoạn ngắn (Q-23 góp ý 04/10). */
export function DiagramGuideDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const parts = [
    ['diagrams.guide.modesTitle', 'diagrams.guide.modes'],
    ['diagrams.guide.cablesTitle', 'diagrams.guide.cables'],
    ['diagrams.guide.framesTitle', 'diagrams.guide.frames'],
    ['diagrams.guide.versionsTitle', 'diagrams.guide.versions'],
    ['diagrams.guide.codeTitle', 'diagrams.guide.code'],
  ];
  return (
    <Dialog open onOpenChange={onClose} maxWidth={620} initialFocus="title" title={t('diagrams.guide.title')}>
      {parts.map(([title, text]) => (
        <section key={title}>
          <h3>{t(title)}</h3>
          <p>{t(text)}</p>
        </section>
      ))}
    </Dialog>
  );
}

/** Các bước bắt đầu khi bản vẽ còn trống ở chế độ Sửa — nổi trên trình vẽ, bấm "Ẩn" hoặc vẽ là tắt. */
export function EditStartCard({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="diagram-start-card" aria-labelledby="diagram-start-title">
      <h2 id="diagram-start-title">{t('diagrams.editSteps.title')}</h2>
      <StepList
        label={t('diagrams.stepsLabel')}
        steps={[t('diagrams.editSteps.stock'), t('diagrams.editSteps.cable'), t('diagrams.editSteps.save'), t('diagrams.editSteps.publish')]}
      />
      <button type="button" className="btn sm" onClick={onDismiss}>
        {t('diagrams.editSteps.dismiss')}
      </button>
    </section>
  );
}
