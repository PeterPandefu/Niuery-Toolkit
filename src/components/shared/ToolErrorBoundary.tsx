import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/utils';
import { createLogger } from '@/lib/logger';

interface ToolErrorBoundaryProps {
  toolId: string;
  toolName: string;
  children: ReactNode;
  labels: {
    title: string;
    description: string;
    retry: string;
    copyDetails: string;
    copied: string;
    copyFailed: string;
  };
}

interface ToolErrorBoundaryState {
  error: Error | null;
}

export class ToolErrorBoundary extends Component<ToolErrorBoundaryProps, ToolErrorBoundaryState> {
  state: ToolErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): Partial<ToolErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    createLogger(`tool:${this.props.toolId}`).error('工具运行时异常', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleCopyDetails = async () => {
    const error = this.state.error;
    if (!error) return;
    const details = `${this.props.toolId}\n${error.name}: ${error.message}\n${error.stack ?? ''}`;
    const copied = await copyToClipboard(details);
    toast[copied ? 'success' : 'error'](copied ? this.props.labels.copied : this.props.labels.copyFailed);
  };

  render() {
    const { error } = this.state;
    if (!error) return <>{this.props.children}</>;

    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <section className="w-full max-w-lg rounded-xl border border-destructive/30 bg-card p-6 shadow-tinted-sm" role="alert" aria-live="assertive">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-heading text-base font-semibold text-foreground">{this.props.labels.title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{this.props.labels.description.replace('{{tool}}', this.props.toolName)}</p>
              <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-5 text-muted-foreground">{error.message}</pre>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={this.handleRetry}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {this.props.labels.retry}
            </Button>
            <Button variant="outline" onClick={this.handleCopyDetails}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              {this.props.labels.copyDetails}
            </Button>
          </div>
        </section>
      </div>
    );
  }
}

export function LocalizedToolErrorBoundary(props: Omit<ToolErrorBoundaryProps, 'labels'>) {
  const { t } = useTranslation();
  return (
    <ToolErrorBoundary
      {...props}
      labels={{
        title: t('app.toolErrorTitle'),
        description: t('app.toolErrorDesc'),
        retry: t('app.toolErrorRetry'),
        copyDetails: t('app.toolErrorCopyDetails'),
        copied: t('app.toolErrorCopied'),
        copyFailed: t('app.toolErrorCopyFailed'),
      }}
    />
  );
}
