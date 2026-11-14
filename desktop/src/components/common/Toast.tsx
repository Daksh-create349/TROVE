import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";
import { useApp } from "../../context/AppContext";

export function ToastContainer() {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex max-w-sm flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        let Icon = Info;
        let iconColor = "text-blue-400";
        let borderColor = "border-blue-500/30";
        let bgGlow = "bg-blue-500/10";

        if (toast.type === "success") {
          Icon = CheckCircle2;
          iconColor = "text-emerald-400";
          borderColor = "border-emerald-500/30";
          bgGlow = "bg-emerald-500/10";
        } else if (toast.type === "error") {
          Icon = AlertCircle;
          iconColor = "text-rose-400";
          borderColor = "border-rose-500/30";
          bgGlow = "bg-rose-500/10";
        } else if (toast.type === "warning") {
          Icon = AlertTriangle;
          iconColor = "text-amber-400";
          borderColor = "border-amber-500/30";
          bgGlow = "bg-amber-500/10";
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${borderColor} bg-[#12141a]/95 p-3.5 shadow-2xl backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-2`}
          >
            <div className={`mt-0.5 rounded-lg p-1.5 ${bgGlow}`}>
              <Icon className={`h-4 w-4 ${iconColor}`} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-100">{toast.title}</div>
              {toast.message && (
                <div className="mt-0.5 text-2xs text-slate-400 leading-relaxed truncate">
                  {toast.message}
                </div>
              )}
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-500 hover:text-slate-300 transition-colors p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
