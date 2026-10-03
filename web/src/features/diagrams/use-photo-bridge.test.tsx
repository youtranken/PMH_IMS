import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import type { DrawioCommand } from '@/ui/drawio-protocol';
import { DEVICE_LOOKS_BATCH, usePhotoBridge } from './use-photo-bridge';

/**
 * Công tắc "Biểu tượng / Ảnh thật" (Story 10.11): hộp liệt kê ô thiết bị của trang đang mở; lựa
 * chọn không có ảnh thì tắt kèm lý do; chọn ảnh là sửa ô bằng `patch` (không `merge`).
 */
const DEV = '7b0c1c1e-0000-4000-8000-000000000001';
const XML =
  '<mxfile><diagram id="p1" name="A"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  `<UserObject label="SW-E2E-01" ims_device_id="${DEV}" ims_device_code="SW-E2E-01" id="c1"><mxCell style="fillColor=none;shape=mxgraph.cisco.switch;html=0;" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></UserObject>` +
  '</root></mxGraphModel></diagram></mxfile>';

const LOOKS = {
  imsStyleKeys: ['shape', 'image', 'imageAspect', 'aspect', 'outlineConnect', 'html', 'verticalLabelPosition', 'verticalAlign'],
  items: [
    {
      id: DEV,
      found: true,
      icon: 'shape=mxgraph.cisco.switch;html=0;',
      front: { style: 'shape=image;image=data:image/png,AAAA;imageAspect=1;html=0;', fileId: 'f-front' },
      back: null,
    },
  ],
};

function Harness({ sent, withFile = (fn) => fn(XML) }: { sent: DrawioCommand[]; withFile?: (fn: (xml: string) => void) => void }) {
  const bridge = usePhotoBridge({
    ready: true,
    withFile,
    send: (command) => sent.push(command),
    page: () => 0,
    markDirty: () => undefined,
  });
  return (
    <>
      {bridge.menu.map((item) => (
        <button key={item.key} type="button" onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
      {bridge.dialogs}
    </>
  );
}

describe('usePhotoBridge — công tắc Biểu tượng / Ảnh thật', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mặt không có ảnh: lựa chọn tắt kèm lý do; chọn ảnh mặt trước gửi patch gắn ims_photo', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve(jsonResponse(200, LOOKS));
      }),
    );
    const sent: DrawioCommand[] = [];
    renderWithI18n(<Harness sent={sent} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ảnh thật…' }));

    const group = await screen.findByRole('radiogroup', { name: 'Hình của SW-E2E-01' });
    expect(urls[0]).toBe(`/api/v1/diagrams/device-looks?ids=${DEV}`);
    expect(screen.getByRole('radio', { name: /Biểu tượng/ })).toBeChecked();
    const back = screen.getByRole('radio', { name: /Ảnh mặt sau/ });
    expect(back).toBeDisabled();
    expect(group).toHaveTextContent('Máy chưa có ảnh mặt sau');

    await act(async () => {
      await user.click(screen.getByRole('radio', { name: /Ảnh mặt trước/ }));
    });
    await waitFor(() => expect(sent).toHaveLength(1));
    const command = sent[0] as { action: string; patch: { u: Record<string, { cells: { u: Record<string, { style: string; xmlValue: string }> } }> } };
    expect(command.action).toBe('patch');
    const update = command.patch.u.p1.cells.u.c1;
    expect(update.style).toBe('fillColor=none;shape=image;image=data:image/png,AAAA;imageAspect=1;html=0;');
    expect(update.xmlValue).toContain('ims_photo="front"');
  });

  it('trang nhiều máy: hỏi theo lô DEVICE_LOOKS_BATCH (trần của server), gộp kết quả', async () => {
    const ids = Array.from({ length: DEVICE_LOOKS_BATCH + 5 }, (_, i) => `7b0c1c1e-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const many =
      '<mxfile><diagram id="p1" name="A"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      ids
        .map(
          (id, i) =>
            `<UserObject label="SW-E2E-${i}" ims_device_id="${id}" ims_device_code="SW-E2E-${i}" id="c${i}"><mxCell style="shape=mxgraph.cisco.switch;html=0;" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></UserObject>`,
        )
        .join('') +
      '</root></mxGraphModel></diagram></mxfile>';
    const asked: string[][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const batch = new URL(url, 'http://x').searchParams.get('ids')!.split(',');
        asked.push(batch);
        return Promise.resolve(
          jsonResponse(200, { imsStyleKeys: LOOKS.imsStyleKeys, items: batch.map((id) => ({ id, found: true, icon: 'shape=x;', front: null, back: null })) }),
        );
      }),
    );
    renderWithI18n(<Harness sent={[]} withFile={(fn) => fn(many)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ảnh thật…' }));
    await screen.findByRole('radiogroup', { name: `Hình của SW-E2E-${ids.length - 1}` });
    expect(asked.map((b) => b.length)).toEqual([DEVICE_LOOKS_BATCH, 5]);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(ids.length);
  });

  it('chọn xong là hộp đánh dấu ngay lựa chọn mới, không chờ trình vẽ trả lại tệp', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, LOOKS))));
    // Lượt đọc tệp sau khi đổi đi vòng qua draw.io (postMessage): ở đây nó chưa về.
    let reads = 0;
    const withFile = (fn: (xml: string) => void) => {
      reads += 1;
      if (reads === 1) fn(XML);
    };
    renderWithI18n(<Harness sent={[]} withFile={withFile} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ảnh thật…' }));
    await screen.findByRole('radiogroup', { name: 'Hình của SW-E2E-01' });
    await user.click(screen.getByRole('radio', { name: /Ảnh mặt trước/ }));
    expect(screen.getByRole('radio', { name: /Ảnh mặt trước/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Biểu tượng/ })).not.toBeChecked();
  });
});
