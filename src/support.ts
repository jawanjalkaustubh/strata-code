import raw from '../support.json';

/**
 * Project links, from support.json at the repo root. Both optional: a
 * component renders a link only when its URL is set.
 */
export interface SupportLinks {
  projectUrl: string;
  issuesUrl: string;
}

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/\S+$/i.test(u);

export const SUPPORT: SupportLinks = {
  projectUrl: isHttp((raw as any).projectUrl) ? (raw as any).projectUrl : '',
  issuesUrl: isHttp((raw as any).issuesUrl) ? (raw as any).issuesUrl : ''
};

export function openExternal(url: string) {
  if (!isHttp(url)) return;
  const api = (window as any).api;
  if (api?.openExternalUrl) api.openExternalUrl(url);
  else window.open(url, '_blank', 'noopener');
}
