import raw from '../support.json';

/**
 * Project and donation links, from support.json at the repo root. Everything
 * is optional: a component renders its link only when the URL is set, so a
 * build with an empty support.json simply has no donate button.
 */
export interface SupportLinks {
  projectUrl: string;
  issuesUrl: string;
  donateUrl: string;
  donateLabel: string;
}

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/\S+$/i.test(u);

export const SUPPORT: SupportLinks = {
  projectUrl: isHttp((raw as any).projectUrl) ? (raw as any).projectUrl : '',
  issuesUrl: isHttp((raw as any).issuesUrl) ? (raw as any).issuesUrl : '',
  donateUrl: isHttp((raw as any).donateUrl) ? (raw as any).donateUrl : '',
  donateLabel: typeof (raw as any).donateLabel === 'string' && (raw as any).donateLabel.trim() ? (raw as any).donateLabel.trim() : 'Support development'
};

export function openExternal(url: string) {
  if (!isHttp(url)) return;
  const api = (window as any).api;
  if (api?.openExternalUrl) api.openExternalUrl(url);
  else window.open(url, '_blank', 'noopener');
}
