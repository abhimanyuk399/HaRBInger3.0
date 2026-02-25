const apiBase = '/api';

export const api = {
  issuer: `${apiBase}/issuer`,
  registry: `${apiBase}/registry`,
  consent: `${apiBase}/consent`,
  wallet: `${apiBase}/wallet`,
  fi: `${apiBase}/fi`,
  ckyc: `${apiBase}/ckyc`,
  review: `${apiBase}/review`,
};

export function routeFor(serviceBase: string, path: string): string {
  return `${serviceBase}${path.startsWith('/') ? path : `/${path}`}`;
}
