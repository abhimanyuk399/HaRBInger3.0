import type { LucideIcon } from 'lucide-react';
import { Activity, ArrowLeftRight, BriefcaseBusiness, Building2, Gauge, Handshake, ShieldCheck } from 'lucide-react';

export interface ConsoleNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  description: string;
  external?: boolean;
}

export const consoleNavItems: ConsoleNavItem[] = [
  {
    label: 'Command Center',
    path: '/console',
    icon: Gauge,
    description: 'Operations dashboard and workflow checklist',
  },
  {
    label: 'Scenario Orchestration',
    path: '/console/scenario',
    icon: ArrowLeftRight,
    description: 'Primary end-to-end flow runner',
  },
  {
    label: 'Wallet Ops',
    path: '/console/wallet',
    icon: BriefcaseBusiness,
    description: 'Wallet login, consent actions, delegation',
  },
  {
    label: 'FI Console',
    path: '/console/fi',
    icon: Building2,
    description: 'FI requests, FI2 reuse, verification triggers',
  },
  {
    label: 'Verifier',
    path: '/console/verifier',
    icon: ShieldCheck,
    description: 'Verification outcomes and shared payload view',
  },
  {
    label: 'Integrations',
    path: '/console/integrations',
    icon: Handshake,
    description: 'Integration readiness and CKYCR status',
  },
  {
    label: 'Audit',
    path: '/console/audit',
    icon: Activity,
    description: 'Audit timeline and request/response inspector',
  },
];

export const consolePageTitles: Record<string, string> = {
  '/console': 'Command Center',
  '/console/scenario': 'Scenario Orchestration',
  '/console/wallet': 'Wallet Ops',
  '/console/fi': 'FI Console',
  '/console/verifier': 'Verifier',
  '/console/integrations': 'Integrations',
  '/console/audit': 'Audit',
};
