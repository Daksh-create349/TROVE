import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught Trove component error:", error, errorInfo);
  }

  public handleReload = () => {
    window.location.reload();
  };

  public handleReset = () => {
    localStorage.removeItem("trove_onboarded");
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#070b15] text-slate-100 p-6 select-none">
          <div className="w-full max-w-md rounded-3xl border border-rose-500/20 bg-[#0e1424] p-8 text-center shadow-2xl space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
              <AlertTriangle className="h-7 w-7" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-white tracking-tight">Something went wrong</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Trove encountered an unexpected rendering error. Your data and Telegram sessions remain completely safe.
              </p>
            </div>

            {this.state.error && (
              <div className="rounded-xl bg-black/40 border border-slate-800 p-3 text-left font-mono text-[11px] text-rose-300 max-h-32 overflow-y-auto break-all">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-500/25 transition-all cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Reload Window</span>
              </button>

              <button
                onClick={this.handleReset}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-800/60 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                <span>Reset Onboarding</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
