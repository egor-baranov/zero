import * as React from 'react';
import { Shell } from '@renderer/features/shell/shell';

interface RendererCrashBoundaryState {
  error: Error | null;
  componentStack: string;
}

class RendererCrashBoundary extends React.Component<
  React.PropsWithChildren,
  RendererCrashBoundaryState
> {
  public state: RendererCrashBoundaryState = {
    error: null,
    componentStack: '',
  };

  public static getDerivedStateFromError(error: Error): RendererCrashBoundaryState {
    return {
      error,
      componentStack: '',
    };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Renderer crash boundary caught an error.', error, info);
    this.setState({
      error,
      componentStack: info.componentStack,
    });
  }

  public render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f4] px-6 py-8 text-stone-800">
        <div className="w-full max-w-[920px] rounded-[28px] border border-stone-200 bg-white px-6 py-5 shadow-[0_24px_80px_-48px_rgba(28,25,23,0.35)]">
          <p className="text-[12px] font-semibold uppercase tracking-[0.24em] text-stone-500">
            Renderer Error
          </p>
          <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] text-stone-900">
            The app hit a runtime error.
          </h1>
          <p className="mt-2 text-[14px] leading-6 text-stone-600">
            Reload the window after copying the error details below.
          </p>

          <div className="mt-5 rounded-[20px] border border-stone-200 bg-stone-50 px-4 py-3">
            <p className="text-[13px] font-medium text-stone-900">
              {this.state.error.message || 'Unknown renderer error'}
            </p>
            {this.state.componentStack ? (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-stone-600">
                {this.state.componentStack}
              </pre>
            ) : null}
            {this.state.error.stack ? (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-stone-500">
                {this.state.error.stack}
              </pre>
            ) : null}
          </div>

          <button
            type="button"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-[14px] bg-stone-900 px-4 text-[13px] font-medium text-white transition-colors hover:bg-stone-800"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload window
          </button>
        </div>
      </main>
    );
  }
}

export const App = (): JSX.Element => {
  return (
    <RendererCrashBoundary>
      <Shell />
    </RendererCrashBoundary>
  );
};
