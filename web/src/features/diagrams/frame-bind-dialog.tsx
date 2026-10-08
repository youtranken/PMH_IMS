import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { SegmentedRadio } from '@/ui/segmented-radio';
import { Select } from '@/ui/select';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { TREE_KEY, type DiagramNode } from './diagram-api';
import { pathOf, subtreeIds } from './diagram-tree';
import type { FrameCandidate } from './frame-bridge';

type Kind = 'child' | 'subnet' | 'cabinet';

/** Dòng `GET /ipam/subnets` mà hộp cần (dải đang dùng). */
interface SubnetOption {
  id: string;
  name: string;
  cidr: string;
  vlan: number | null;
}

/** Thuộc tính khung mà mỗi kiểu gắn đặt (AD-18). */
export const FRAME_ATTR: Record<Kind, 'ims_child_diagram_id' | 'ims_subnet_id' | 'ims_cabinet_id'> = {
  child: 'ims_child_diagram_id',
  subnet: 'ims_subnet_id',
  cabinet: 'ims_cabinet_id',
};

/**
 * Nhãn khung sau khi đổi tủ: thay mã tủ cũ trong nhãn bằng mã mới ("Tủ TU-04 · Mặt trước" →
 * "Tủ TU-01 · Mặt trước"); nhãn không chứa mã cũ thì dùng `fallback` (nhãn chuẩn của tủ mới).
 */
export function rebindCabinetLabel(label: string, oldCode: string | null, newCode: string, fallback: string): string {
  return oldCode && label.includes(oldCode) ? label.split(oldCode).join(newCode) : fallback;
}

/**
 * Hộp "Gắn khung" của màn sửa (FR-039): chọn một hình đã vẽ (theo chữ trên hình — giao thức nhúng
 * không báo ô đang chọn), rồi gắn nó với một bản vẽ con hoặc một dải IP. Chỉ mời chọn bản vẽ NẰM
 * DƯỚI bản vẽ này, chưa lưu trữ, không phải bản trình bày — server kiểm lại lúc lưu.
 *
 * Khung tủ (đã mang `ims_cabinet_id`) có thêm "Đổi tủ của khung này" (Q-23): chèn nhầm tủ thì
 * chọn lại tủ cho chính khung đó, giữ nguyên hình và máy bên trong — máy kho ghi tủ khác sẽ được báo
 * như mọi máy nằm sai khung. Chỉ đổi bản vẽ, không ghi gì vào kho.
 */
export function FrameBindDialog({
  diagramId,
  frames,
  onBind,
  onClose,
}: {
  diagramId: string;
  /** Hình đọc từ XML cả tệp lúc mở hộp. */
  frames: FrameCandidate[];
  /**
   * `value = null` = bỏ gắn kiểu đó; `label` = nhãn mới của khung (đổi tủ); `badge` = chữ dấu "đã
   * gắn" dưới khung sau lần gắn này (`null` = khung không còn gắn gì, vắng = không đụng dấu).
   */
  onBind: (frame: FrameCandidate, attr: string, value: string | null, label?: string, badge?: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [frameId, setFrameId] = useState(frames[0]?.id ?? '');
  const [kind, setKind] = useState<Kind>('child');
  const frame = frames.find((f) => f.id === frameId) ?? null;
  // Kiểu "Tủ mạng" chỉ có nghĩa với khung tủ: đổi khung sang hình thường thì về kiểu bản vẽ con.
  const kindNow: Kind = kind === 'cabinet' && !frame?.cabinetId ? 'child' : kind;
  const bound = frame ? (kindNow === 'child' ? frame.childDiagramId : kindNow === 'subnet' ? frame.subnetId : null) : null;
  const [target, setTarget] = useState('');
  const lists = useCatalogLists({ enabled: kindNow === 'cabinet' });
  const cabinets = lists.data?.cabinets ?? [];
  const oldCabinet = frame?.cabinetId ? (cabinets.find((c) => c.id === frame.cabinetId) ?? null) : null;
  const cabinetOptions = activeOptions(
    cabinets.filter((c) => c.id !== frame?.cabinetId),
    target,
    (c) => `${c.siteCode} · ${c.code}`,
  );
  const tree = useQuery({ queryKey: TREE_KEY, queryFn: () => apiFetch<DiagramNode[]>('/api/v1/diagrams') });
  const subnets = useQuery({
    queryKey: ['diagram-frame-subnets'],
    queryFn: () => apiFetch<SubnetOption[]>('/api/v1/ipam/subnets'),
    // Khung đang gắn dải: dấu sau khi gắn thêm bản vẽ con vẫn phải nói dải nào.
    enabled: kind === 'subnet' || Boolean(frame?.subnetId),
  });

  const nodes = tree.data ?? [];
  const below = subtreeIds(nodes, diagramId);
  const children = nodes.filter((n) => n.id !== diagramId && below.has(n.id) && n.kind !== 'presentation' && !n.archivedAt);
  const childOptions = children.map((n) => ({
    value: n.id,
    label: pathOf(nodes, n.id)
      .filter((p) => below.has(p.id) && p.id !== diagramId)
      .map((p) => p.name)
      .join(' / '),
  }));
  const subnetOptions = (subnets.data ?? []).map((s) => ({
    value: s.id,
    label: s.vlan !== null ? t('diagrams.frames.subnetOptionVlan', { cidr: s.cidr, vlan: s.vlan, name: s.name }) : t('diagrams.frames.subnetOption', { cidr: s.cidr, name: s.name }),
  }));
  const frameLabel = (f: FrameCandidate) => f.label || t('diagrams.frames.unnamed', { id: f.id });
  const currentText = (() => {
    if (!frame) return null;
    const parts: string[] = [];
    if (frame.childDiagramId) {
      const name = nodes.find((n) => n.id === frame.childDiagramId)?.name ?? frame.childDiagramId;
      parts.push(t('diagrams.frames.currentChild', { name }));
    }
    if (frame.subnetId) {
      const cidr = subnets.data?.find((s) => s.id === frame.subnetId)?.cidr ?? frame.subnetId;
      parts.push(t('diagrams.frames.currentSubnet', { cidr }));
    }
    if (frame.cabinetId) parts.push(t('diagrams.frames.currentCabinet'));
    return parts.length > 0 ? t('diagrams.frames.current', { what: parts.join(', ') }) : t('diagrams.frames.currentNone');
  })();

  /** Chữ dấu "đã gắn" theo những gì khung sẽ gắn sau lần bấm này. */
  const badgeFor = (childId: string | null, subnetId: string | null): string | null => {
    const parts: string[] = [];
    if (childId) parts.push(t('diagrams.frames.badgeChild', { name: nodes.find((n) => n.id === childId)?.name ?? '' }));
    if (subnetId) parts.push(t('diagrams.frames.badgeSubnet', { cidr: subnets.data?.find((s) => s.id === subnetId)?.cidr ?? '' }));
    return parts.length > 0 ? t('diagrams.frames.badge', { what: parts.join(' · ') }) : null;
  };
  const bindTo = (value: string | null) => {
    if (!frame) return;
    const child = kindNow === 'child' ? value : frame.childDiagramId;
    const subnet = kindNow === 'subnet' ? value : frame.subnetId;
    onBind(frame, FRAME_ATTR[kindNow], value, undefined, badgeFor(child, subnet));
  };

  const rebind = () => {
    const next = cabinets.find((c) => c.id === target);
    if (!frame || !next) return;
    onBind(frame, FRAME_ATTR.cabinet, next.id, rebindCabinetLabel(frame.label, oldCabinet?.code ?? null, next.code, t('diagrams.frames.cabinetFrameLabel', { code: next.code })));
  };
  const footer = (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      {frame && bound ? (
        <button type="button" className="btn" onClick={() => bindTo(null)}>
          {t('diagrams.frames.unbind')}
        </button>
      ) : null}
      {kindNow === 'cabinet' ? (
        <button type="button" className="btn primary" disabled={!frame || !target} onClick={rebind}>
          {t('diagrams.frames.rebindCabinet')}
        </button>
      ) : (
        <button type="button" className="btn primary" disabled={!frame || !target} onClick={() => bindTo(target)}>
          {t('diagrams.frames.bind')}
        </button>
      )}
    </div>
  );

  return (
    <Dialog open onOpenChange={onClose} title={t('diagrams.frames.bindTitle')} initialFocus="first-field" footer={frames.length > 0 ? footer : undefined}>
      <p className="muted">{t('diagrams.frames.bindHint')}</p>
      {frames.length === 0 ? (
        <p className="alert info" role="status">
          {t('diagrams.frames.noFrames')}
        </p>
      ) : (
        <div className="form-grid">
          <Field label={t('diagrams.frames.frame')} htmlFor="diagram-frame-pick" hint={currentText ?? undefined}>
            <Select
              id="diagram-frame-pick"
              value={frameId}
              placeholder={t('diagrams.frames.framePlaceholder')}
              searchable
              options={frames.map((f) => ({ value: f.id, label: frameLabel(f) }))}
              onChange={(value) => {
                setFrameId(value);
                setTarget('');
              }}
            />
          </Field>
          <SegmentedRadio<Kind>
            className="fill"
            label={t('diagrams.frames.kind')}
            value={kindNow}
            options={[
              { value: 'child', label: t('diagrams.frames.kindChild') },
              { value: 'subnet', label: t('diagrams.frames.kindSubnet') },
              ...(frame?.cabinetId ? [{ value: 'cabinet' as const, label: t('diagrams.frames.kindCabinet') }] : []),
            ]}
            onChange={(value) => {
              setKind(value);
              setTarget('');
            }}
          />
          {kindNow === 'cabinet' ? (
            <Field label={t('diagrams.frames.cabinetNew')} htmlFor="diagram-frame-cabinet" hint={t('diagrams.frames.rebindHint', { code: oldCabinet?.code ?? '?' })}>
              <Select
                id="diagram-frame-cabinet"
                value={target}
                placeholder={t('diagrams.frames.cabinetPlaceholder')}
                failed={lists.isError}
                searchable
                options={cabinetOptions}
                onChange={setTarget}
              />
            </Field>
          ) : kindNow === 'child' ? (
            tree.isSuccess && childOptions.length === 0 ? (
              <p className="muted">{t('diagrams.frames.noChildren')}</p>
            ) : (
              <Field label={t('diagrams.frames.child')} htmlFor="diagram-frame-child">
                <Select
                  id="diagram-frame-child"
                  value={target}
                  placeholder={t('diagrams.frames.childPlaceholder')}
                  failed={tree.isError}
                  searchable
                  options={childOptions}
                  onChange={setTarget}
                />
              </Field>
            )
          ) : (
            <Field label={t('diagrams.frames.subnet')} htmlFor="diagram-frame-subnet">
              <Select
                id="diagram-frame-subnet"
                value={target}
                placeholder={t('diagrams.frames.subnetPlaceholder')}
                failed={subnets.isError}
                searchable
                options={subnetOptions}
                onChange={setTarget}
              />
            </Field>
          )}
        </div>
      )}
    </Dialog>
  );
}
