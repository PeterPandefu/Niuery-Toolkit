import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from './button';

type LoadingButtonProps = Omit<ButtonProps, 'onClick'> & {
  onClick?: () => void | Promise<void>;
  loading?: boolean;
  loadingLabel?: string;
};

/** Button that disables itself and shows a spinner while its async click is pending. */
export function LoadingButton({ onClick, loading = false, loadingLabel, children, disabled, ...props }: LoadingButtonProps) {
  const [internalLoading, setInternalLoading] = React.useState(false);
  const busy = loading || internalLoading;

  const handleClick = async () => {
    if (!onClick || busy) return;
    const result = onClick();
    if (result && typeof (result as Promise<void>).then === 'function') {
      setInternalLoading(true);
      try {
        await result;
      } finally {
        setInternalLoading(false);
      }
    }
  };

  return (
    <Button {...props} onClick={() => void handleClick()} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
      {busy && loadingLabel ? loadingLabel : children}
    </Button>
  );
}
