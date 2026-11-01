import React, { useState, useEffect } from 'react';
import { Check, X, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
}

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

const Toast: React.FC<ToastProps> = ({ message, type = 'info', duration = 2000, onClose }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(onClose || (() => {}), 300);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(onClose || (() => {}), 300);
  };

  const getConfig = () => {
    switch (type) {
      case 'success':
        return {
          icon: <Check size={18} strokeWidth={3} className="text-white" />,
          iconBg: 'bg-emerald-500',
          barColor: 'bg-emerald-400',
          shadow: 'shadow-emerald-500/15',
        };
      case 'error':
        return {
          icon: <X size={18} strokeWidth={3} className="text-white" />,
          iconBg: 'bg-red-500',
          barColor: 'bg-red-400',
          shadow: 'shadow-red-500/15',
        };
      case 'warning':
        return {
          icon: <AlertTriangle size={18} strokeWidth={3} className="text-white" />,
          iconBg: 'bg-amber-500',
          barColor: 'bg-amber-400',
          shadow: 'shadow-amber-500/15',
        };
      case 'info':
      default:
        return {
          icon: <Info size={18} strokeWidth={3} className="text-white" />,
          iconBg: 'bg-blue-500',
          barColor: 'bg-blue-400',
          shadow: 'shadow-blue-500/15',
        };
    }
  };

  const config = getConfig();

  return (
    <div
      className={`
        toast-item relative flex items-center gap-3 pl-3 pr-9 py-3 rounded-2xl border
        bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl
        border-slate-200/70 dark:border-slate-700/50
        shadow-lg ${config.shadow}
        max-w-sm
        ${isExiting ? 'toast-exit' : ''}
      `}
    >
      {/* 图标圆形背景 */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full ${config.iconBg} flex items-center justify-center shadow-sm`}>
        {config.icon}
      </div>
      {/* 消息文本 */}
      <div className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 leading-snug">
        {message}
      </div>
      {/* 关闭按钮 */}
      <button
        onClick={handleClose}
        className="absolute top-1.5 right-1.5 p-1 rounded-lg text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
        aria-label="关闭"
      >
        <X size={14} />
      </button>
      {/* 自动消失进度条 */}
      {duration > 0 && (
        <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full overflow-hidden opacity-50">
          <div
            className={`h-full ${config.barColor}`}
            style={{ animation: `toastProgress ${duration}ms linear forwards` }}
          />
        </div>
      )}
    </div>
  );
};

export const ToastContainer: React.FC<{ toasts: ToastItem[]; onRemove: (id: string) => void }> = ({ toasts, onRemove }) => {
  return (
    <div className="fixed top-6 right-4 z-[9999] flex flex-col items-end gap-2.5 pointer-events-none">
      <div className="flex flex-col items-end gap-2.5 pointer-events-auto">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => onRemove(toast.id)}
          />
        ))}
      </div>
    </div>
  );
};

class ToastManager {
  private static instance: ToastManager;
  private listeners: Array<(toasts: ToastItem[]) => void> = [];
  private toasts: ToastItem[] = [];

  static getInstance(): ToastManager {
    if (!ToastManager.instance) {
      ToastManager.instance = new ToastManager();
    }
    return ToastManager.instance;
  }

  subscribe(listener: (toasts: ToastItem[]) => void) {
    this.listeners.push(listener);
    listener(this.toasts);
  }

  unsubscribe(listener: (toasts: ToastItem[]) => void) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private notify() {
    this.listeners.forEach(listener => listener(this.toasts));
  }

  add(message: string, type: ToastType = 'info', duration: number = 2000): string {
    const id = Date.now().toString() + Math.random().toString(36);
    const toast: ToastItem = { id, message, type, duration };
    this.toasts.push(toast);
    this.notify();
    return id;
  }

  remove(id: string) {
    this.toasts = this.toasts.filter(toast => toast.id !== id);
    this.notify();
  }

  success(message: string, duration?: number) {
    return this.add(message, 'success', duration);
  }

  error(message: string, duration?: number) {
    return this.add(message, 'error', duration);
  }

  warning(message: string, duration?: number) {
    return this.add(message, 'warning', duration);
  }

  info(message: string, duration?: number) {
    return this.add(message, 'info', duration);
  }
}

export const useToast = () => {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    const manager = ToastManager.getInstance();
    const handler = (currentToasts: ToastItem[]) => {
      setToasts([...currentToasts]);
    };
    manager.subscribe(handler);
    return () => {
      manager.unsubscribe(handler);
    };
  }, []);

  const removeToast = React.useCallback((id: string) => {
    ToastManager.getInstance().remove(id);
  }, []);

  const showToast = React.useCallback((message: string, type: ToastType, duration?: number) => {
    return ToastManager.getInstance().add(message, type, duration);
  }, []);

  return {
    toasts,
    removeToast,
    success: (message: string, duration?: number) => showToast(message, 'success', duration),
    error: (message: string, duration?: number) => showToast(message, 'error', duration),
    warning: (message: string, duration?: number) => showToast(message, 'warning', duration),
    info: (message: string, duration?: number) => showToast(message, 'info', duration),
  };
};

export const toast = ToastManager.getInstance();

export default Toast;
