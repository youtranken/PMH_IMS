import { useTranslation } from 'react-i18next';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { StepList } from '@/ui/step-list';

/**
 * Mục của hướng dẫn: tiêu đề + 1–3 gạch (V-08 — năm đoạn chữ liền không ai đọc, và thiếu nửa số
 * việc của màn). Khoá i18n viết đủ để bài điểm danh khoá chết thấy nơi dùng.
 */
const SECTIONS: [string, string[]][] = [
  ['diagrams.guide.modesTitle', ['diagrams.guide.modes1', 'diagrams.guide.modes2']],
  ['diagrams.guide.stockTitle', ['diagrams.guide.stock1', 'diagrams.guide.stock2']],
  ['diagrams.guide.cablesTitle', ['diagrams.guide.cables1', 'diagrams.guide.cables2', 'diagrams.guide.cables3']],
  ['diagrams.guide.routeTitle', ['diagrams.guide.route1', 'diagrams.guide.route2', 'diagrams.guide.route3']],
  ['diagrams.guide.framesTitle', ['diagrams.guide.frames1', 'diagrams.guide.frames2']],
  ['diagrams.guide.navTitle', ['diagrams.guide.nav1', 'diagrams.guide.nav2', 'diagrams.guide.nav3']],
  ['diagrams.guide.versionsTitle', ['diagrams.guide.versions1', 'diagrams.guide.versions2']],
  ['diagrams.guide.presentationTitle', ['diagrams.guide.presentation1', 'diagrams.guide.presentation2']],
  ['diagrams.guide.mobileTitle', ['diagrams.guide.mobile1']],
  ['diagrams.guide.menuTitle', ['diagrams.guide.menu1']],
  ['diagrams.guide.codeTitle', ['diagrams.guide.code1']],
];

/** Hộp "Hướng dẫn" mở từ menu ⋮ của thanh sơ đồ: mỗi việc một mục ngắn (Q-23). */
export function DiagramGuideDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={620}
      initialFocus="title"
      title={t('diagrams.guide.title')}
      footer={<DialogCancel>{t('common.close')}</DialogCancel>}
    >
      <div className="diagram-guide">
        {SECTIONS.map(([title, items]) => (
          <section key={title}>
            <h3>{t(title)}</h3>
            <ul>
              {items.map((item) => (
                <li key={item}>{t(item)}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
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
