import { Link } from 'react-router-dom';
import { ConsoleButton } from './ConsoleButton';

interface WalletAuthOptionalBannerProps {
  open: boolean;
  onDismiss: () => void;
  walletPath?: string;
  title?: string;
}

export function WalletAuthOptionalBanner({
  open,
  onDismiss,
  walletPath = '/wallet/ops',
  title = 'Wallet authentication (optional for demo)',
}: WalletAuthOptionalBannerProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-xs">
        Some steps can use wallet approval. You can continue without logging in; if a call requires auth, the page will
        show an inline warning.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link
          to={walletPath}
          className="inline-flex items-center rounded-lg border border-blue-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
        >
          Go to Wallet Ops
        </Link>
        <ConsoleButton intent="secondary" size="sm" onClick={onDismiss}>
          Dismiss
        </ConsoleButton>
      </div>
    </div>
  );
}
