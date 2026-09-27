import { Component, type ReactNode } from 'react';
import { ScreenError } from '@/ui/load-state';

/**
 * Chặn lỗi render ở tầng màn (FE-01). Không có nó, một `TypeError` trong một màn làm React gỡ cả
 * cây: mất luôn sidebar, người dùng chỉ còn F5.
 *
 * `resetKey` đổi (thường là pathname) thì gỡ trạng thái lỗi: người dùng bấm sang màn khác trên
 * sidebar là thoát, không kẹt lại khối báo lỗi.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: unknown },
  { failedAt: unknown; failed: boolean }
> {
  state = { failed: false, failedAt: undefined as unknown };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.setState({ failedAt: this.props.resetKey });
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false, failedAt: undefined });
    }
  }

  render() {
    return this.state.failed ? <ScreenError /> : this.props.children;
  }
}
