function isEnabled(raw: unknown) {
  if (typeof raw !== 'string') {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export const COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED =
  isEnabled(import.meta.env.VITE_COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED) || isEnabled(import.meta.env.VITE_COMMAND_REQUIRE_ADMIN_LOGIN);

export const DEMO_BYPASS_WALLET_LOGIN =
  isEnabled(import.meta.env.VITE_DEMO_BYPASS_LOGIN) || isEnabled(import.meta.env.VITE_DEMO_SKIP_WALLET_LOGIN);
