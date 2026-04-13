import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] 捕获到未处理错误:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-background text-foreground">
            <h2 className="text-lg font-semibold mb-2">出错了</h2>
            <pre className="text-sm text-destructive max-w-2xl overflow-auto p-4 bg-muted rounded">
              {this.state.error.message}
            </pre>
            <pre className="text-xs text-muted-foreground mt-2 max-w-2xl overflow-auto">
              {this.state.error.stack}
            </pre>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={this.handleRetry}
                className="px-4 py-2 rounded-md text-sm font-medium border border-border hover:bg-muted/50 transition-colors"
              >
                重试
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                重新加载应用
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
