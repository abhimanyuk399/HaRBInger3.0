function isEnabled(raw: unknown) {
  if (typeof raw !== 'string') {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function readCommandAdminRequired(...values: Array<unknown>) {
  let sawConfigured = false;
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    sawConfigured = true;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  // Default to true so Command Centre always uses its own explicit login page like FI/Wallet.
  return sawConfigured ? false : true;
}

export const COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED = readCommandAdminRequired(
  import.meta.env.VITE_COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED,
  import.meta.env.VITE_COMMAND_REQUIRE_ADMIN_LOGIN
);

export const DEMO_BYPASS_WALLET_LOGIN =
  isEnabled(import.meta.env.VITE_DEMO_BYPASS_LOGIN) || isEnabled(import.meta.env.VITE_DEMO_SKIP_WALLET_LOGIN);
