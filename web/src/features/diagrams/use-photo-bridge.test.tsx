import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import type { DrawioCommand } from '@/ui/drawio-protocol';
import { usePhotoBridge } from './use-photo-bridge';

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

function Harness({ sent }: { sent: DrawioCommand[] }) {
  const bridge = usePhotoBridge({
    ready: true,
    withFile: (fn) => fn(XML),
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
});
