import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { DEVICE_MODELS_KEY, type DeviceModel } from '@/lib/device-models';
import type { CatalogLists } from '@/lib/catalog-types';

/**
 * Thẻ "Khai trước khi thêm thiết bị" (Q-27): site, tủ, loại, model, nhà cung cấp, phòng ban là
 * thứ form thiết bị và phần mềm chỉ CHỌN lại — thiếu thì người khai máy bị kẹt giữa chừng.
 * Thẻ nói mục nào đủ, mục nào chưa có, model nào chưa có ảnh; bấm ô là sang đúng tab.
 *
 * Đếm model chưa có ảnh trên một trang 100 model: danh mục model của một công ty cỡ này không
 * tới số đó; vượt thì con số chỉ là ước lượng thấp, không sai chiều.
 */
/** Danh sách model cho thẻ này VÀ số trên tab "Model thiết bị" — một lượt gọi, hai chỗ đọc. */
export function useSetupModels() {
  return useQuery({
    queryKey: [...DEVICE_MODELS_KEY, 'setup'],
    queryFn: () => apiFetch<{ items: DeviceModel[]; total: number }>('/api/v1/device-models?limit=100'),
  });
}

export function CatalogSetup({
  lists,
  failed = false,
  onPick,
}: {
  lists: CatalogLists | undefined;
  /** Danh mục tải hỏng — nói ra, đừng để ô "…" mãi như đang tải. */
  failed?: boolean;
  onPick: (tab: string) => void;
}) {
  const { t } = useTranslation();
  const models = useSetupModels();
  /* Đang tải là CHƯA BIẾT ("…"), không phải "chưa có": báo thiếu rồi vài trăm mili-giây sau đổi
     thành "đủ" là một cú nháy cam vô cớ. Đã có câu trả lời mà thiếu hẳn một danh sách thì là 0. */
  const active = <T extends { active?: boolean }>(items: T[] | undefined) =>
    lists === undefined ? undefined : (items ?? []).filter((item) => item.active !== false).length;
  const ready = (count: number | undefined) =>
    failed
      ? { text: t('catalog.setupFailed'), ok: false }
      : count === undefined
      ? { text: '…', ok: true }
      : count > 0
        ? { text: t('catalog.setupReady', { count }), ok: true }
        : { text: t('catalog.setupNone'), ok: false };
  const noPhoto = (models.data?.items ?? []).filter((model) => !model.photoFrontFileId).length;
  const modelState = models.isError
    ? { text: t('catalog.setupFailed'), ok: false }
    : !models.data
    ? { text: '…', ok: true }
    : models.data.total === 0
      ? ready(0)
      : noPhoto > 0
        ? { text: t('catalog.setupNoPhoto', { count: noPhoto }), ok: false }
        : ready(models.data.total);
  const tiles = [
    { key: 'site', label: t('catalog.tabSite'), state: ready(active(lists?.sites)) },
    { key: 'cabinet', label: t('catalog.tabCabinet'), state: ready(active(lists?.cabinets)) },
    { key: 'device_type', label: t('catalog.tabDeviceType'), state: ready(active(lists?.deviceTypes)) },
    { key: 'device_model', label: t('deviceModels.tab'), state: modelState },
    { key: 'vendor', label: t('catalog.tabVendor'), state: ready(active(lists?.vendors)) },
    { key: 'department', label: t('catalog.tabDepartment'), state: ready(active(lists?.departments)) },
  ];
  /* Đủ cả 6 mục thì thẻ thu về một dòng: sáu ô "đủ" chỉ nói một câu, mà trên điện thoại chúng
     cao ~300px, đẩy bảng của tab xuống dưới mép. Còn thiếu (hoặc chưa biết) thì luôn bày ra. */
  const allReady = tiles.every((tile) => tile.state.ok && tile.state.text !== '…');
  const [opened, setOpened] = useState(false);
  const folded = allReady && !opened;
  return (
    <section className={folded ? 'setup-tiles is-folded' : 'setup-tiles'} aria-labelledby="catalog-setup-title">
      <div className="setup-tiles-head">
        <h2 id="catalog-setup-title" className="setup-tiles-title">
          {t('catalog.setupTitle')}
        </h2>
        {allReady ? (
          <button type="button" className="btn sm ghost" aria-expanded={opened} onClick={() => setOpened((value) => !value)}>
            {opened ? t('catalog.setupHide') : t('catalog.setupShow')}
          </button>
        ) : null}
      </div>
      <p className="setup-tiles-hint">{folded ? t('catalog.setupAllReady') : t('catalog.setupHint')}</p>
      {folded ? null : (
      <div className="setup-tiles-grid">
        {tiles.map((tile) => (
          <button key={tile.key} type="button" className="setup-tile" data-ok={tile.state.ok ? 'true' : 'false'} onClick={() => onPick(tile.key)}>
            <span className="setup-tile-label">{tile.label}</span>{' '}
            <span className="setup-tile-state">{tile.state.text}</span>
          </button>
        ))}
      </div>
      )}
    </section>
  );
}
