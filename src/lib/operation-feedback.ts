import { toast } from 'sonner';
import { useLogStore } from '@/store/log-store';

export interface OperationErrorOptions {
  /** 面向用户的简短错误标题或说明。 */
  message: string;
  /** 用于复制和日志定位的详细错误。 */
  error: unknown;
  /** 可选的安全重试动作。 */
  retry?: () => void;
  retryLabel?: string;
  copyLabel?: string;
  logsLabel?: string;
  copiedLabel?: string;
  copyFailedLabel?: string;
}

function toErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return error.stack ? `${error.name}: ${error.message}\n${error.stack}` : `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * 统一长耗时/高失败率操作的错误出口：记录详情已经由调用方完成，
 * 这里提供复制详情、打开日志面板和可选重试三个用户动作。
 */
export function showOperationError(options: OperationErrorOptions) {
  const details = toErrorDetails(options.error);
  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(details);
      toast.success(options.copiedLabel ?? '错误详情已复制');
    } catch {
      toast.error(options.copyFailedLabel ?? '复制失败，请打开日志面板查看详情');
    }
  };

  toast.error(options.message, {
    description: details,
    action: {
      label: options.retry ? (options.retryLabel ?? '重试') : (options.copyLabel ?? '复制详情'),
      onClick: () => {
        if (options.retry) options.retry();
        else void copyDetails();
      },
    },
    cancel: {
      label: options.retry ? (options.copyLabel ?? '复制详情') : (options.logsLabel ?? '查看日志'),
      onClick: () => {
        if (options.retry) void copyDetails();
        else useLogStore.getState().setPanelOpen(true);
      },
    },
  });
}

export function getOperationErrorDetails(error: unknown) {
  return toErrorDetails(error);
}
