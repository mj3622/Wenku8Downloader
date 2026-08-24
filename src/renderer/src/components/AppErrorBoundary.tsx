import {
  Component,
  type ErrorInfo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { reportRendererErrorSafely } from '../logging/error-reporter'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  private handleReturnHome = (event: ReactMouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault()
    window.location.hash = '#/'
    this.setState({ hasError: false })
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRendererErrorSafely(window.electronAPI.reportRendererError, {
      kind: 'error',
      message: error.message || 'Unknown render error',
      stack: error.stack ?? info.componentStack ?? undefined,
    })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="flex min-h-screen items-center justify-center bg-apple-bg p-6">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-card">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-2xl text-red-500" aria-hidden="true">
            !
          </div>
          <h1 className="text-2xl font-semibold text-apple-heading">页面暂时无法显示</h1>
          <p className="mt-3 text-sm leading-6 text-apple-body">
            你可以重新加载应用；如果问题仍然存在，请返回首页后再试。
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              className="rounded-full bg-apple-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-apple-accent/30"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
            <a
              className="rounded-full border border-apple-border-input px-5 py-2.5 text-sm font-medium text-apple-heading hover:bg-black/[0.03] focus:outline-none focus:ring-2 focus:ring-apple-accent/30"
              href="#/"
              onClick={this.handleReturnHome}
            >
              返回首页
            </a>
          </div>
        </section>
      </main>
    )
  }
}
