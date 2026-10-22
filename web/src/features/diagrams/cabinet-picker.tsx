import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoTip } from '@/ui/info-tip';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';

/**
 * Nội dung hộp "Chèn tủ" của màn sửa sơ đồ: lọc site, chọn một tủ trong danh mục rồi Chèn tủ. Tủ đã
 * có khung trên bản vẽ vẫn chọn được nhưng nút Chèn tắt kèm lý do — dựng lần hai là hai khung cùng
 * một tủ, tự kiểm và cảnh báo lệch kho đọc rối.
 */
export function CabinetPicker({
  present,
  busy,
  onInsert,
}: {
  /** Id tủ đã có khung trên bản vẽ (đọc từ XML trình vẽ gửi gần nhất + vừa chèn). */
  present: Set<string>;
  busy: boolean;
  onInsert: (cabinetId: string, code: string) => void;
}) {
  const { t } = useTranslation();
  const lists = useCatalogLists();
  const [siteId, setSiteId] = useState('');
  const [cabinetId, setCabinetId] = useState('');
  const cabinets = (lists.data?.cabinets ?? []).filter((c) => !siteId || c.siteId === siteId);
  const chosen = cabinets.find((c) => c.id === cabinetId) ?? null;
  const already = chosen ? present.has(chosen.id) : false;

  return (
    <div className="stock-picker">
      <p className="muted">
        {t('diagrams.frames.cabinetHint')}{' '}
        <InfoTip subject={t('diagrams.frames.cabinetInsert')}>{t('diagrams.frames.cabinetHintTip')}</InfoTip>
      </p>
      <div className="stock-filters">
        <Select
          value={siteId}
          ariaLabel={t('diagrams.frames.cabinetSite')}
          failed={lists.isError}
          options={[{ value: '', label: t('diagrams.frames.allSites') }, ...activeOptions(lists.data?.sites, siteId, (s) => s.code)]}
          onChange={(value) => {
            setSiteId(value);
            setCabinetId('');
          }}
        />
      </div>
      <Field label={t('diagrams.frames.cabinetLabel')} htmlFor="diagram-cabinet-pick" hint={already ? t('diagrams.frames.cabinetAlready') : undefined}>
        <Select
          id="diagram-cabinet-pick"
          value={cabinetId}
          placeholder={t('diagrams.frames.cabinetPlaceholder')}
          failed={lists.isError}
          searchable
          options={activeOptions(cabinets, cabinetId, (c) => `${c.siteCode} · ${c.code}`)}
          onChange={setCabinetId}
        />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn primary"
          disabled={!chosen || already || busy}
          onClick={() => chosen && onInsert(chosen.id, chosen.code)}
        >
          {busy ? t('diagrams.frames.cabinetInserting') : t('diagrams.frames.cabinetInsert')}
        </button>
      </div>
    </div>
  );
}
