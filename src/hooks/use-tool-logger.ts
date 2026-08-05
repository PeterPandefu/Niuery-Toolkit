import { useEffect, useMemo } from 'react';
import { createLogger, Logger } from '@/lib/logger';

/**
 * 工具日志 Hook
 * 1. 返回绑定工具 ID 的日志实例
 * 2. 自动记录工具组件挂载/卸载生命周期，便于排查工具启停问题
 *
 * 用法：
 *   const log = useToolLogger('base64');
 *   log.info('开始解码', { length: input.length });
 */
export function useToolLogger(toolId: string): Logger {
  const logger = useMemo(() => createLogger(toolId), [toolId]);

  useEffect(() => {
    logger.info('工具已启动（组件挂载）');
    return () => {
      logger.info('工具已停止（组件卸载）');
    };
  }, [logger]);

  return logger;
}
