import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '@/index.css';
import '@/lib/i18n';
import App from '@/App.tsx';
import { queryClient } from '@/lib/api-client';

/*
 * Không `!`: nếu `index.html` mất `<div id="root">` thì `createRoot(null)` ném một lỗi của
 * React nói về `container`, chẳng chỉ ai về đâu. Ném ở đây thì thông báo nói đúng chỗ hỏng.
 */
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Không tìm thấy #root trong index.html — không dựng được ứng dụng.');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
