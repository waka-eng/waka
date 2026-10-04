/** URLs carry identity and view metadata, never memory or search text. */
export type ViewSection = 'top' | 'field' | 'sky';
export interface ViewLocation {
  wallId: string | null;
  label?: string;
  section: ViewSection;
  inspirationId: string | null;
  reflectionId: string | null;
  memberId: string | null;
  at: number | null;
  find: boolean;
  compose: boolean;
  reviewId: string|null;
  reviewAnswerId: string|null;
  principleId:string|null;
  sharePrinciple:boolean;
  conversationId:string|null;
}
export const EMPTY_VIEW: ViewLocation = { wallId: null, section: 'top', inspirationId: null, reflectionId: null, memberId: null, at: null, find: false, compose: false,reviewId:null,reviewAnswerId:null,principleId:null,sharePrinciple:false,conversationId:null };
const id = (value: string | null) => value && /^[a-zA-Z0-9_-]{1,120}$/.test(value) ? value : null;

export function readViewLocation(pathname: string, search = ''): ViewLocation | null {
  let segments: string[];
  try { segments = pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return null; }
  const params = new URLSearchParams(search);
  const view: ViewLocation = { ...EMPTY_VIEW };
  if (segments.length) {
    const legacyLabel = segments.length === 2 && segments[1] && segments[1].length <= 200 && !/[\u0000-\u001f]/.test(segments[1]);
    if (segments[0] === 'w' && segments.length >= 2 && segments.length <= 3 && (id(segments[1]!) || legacyLabel)) {
      view.wallId = segments[1]!; view.label = segments[2];
    } else if (segments[0] === 'inspirations' && segments.length === 2 && id(segments[1]!)) {
      view.inspirationId = segments[1]!;
    } else if(segments[0]==='chat'&&segments.length===2&&id(segments[1]!)){
      view.conversationId=segments[1];return view;
    } else if(segments[0]==='review' && segments.length===2 && id(segments[1]!)) {
      view.reviewId=segments[1]!;
      view.reviewAnswerId=view.reviewId==='new'?null:id(params.get('thought'));
      return view;
    } else if(segments[0]==='principles'&&id(segments[1]??null)&&(segments.length===2||segments.length===3&&segments[2]==='share')){
      view.principleId=segments[1];view.sharePrinciple=segments.length===3;view.section='sky';return view;
    } else return null;
  }
  view.inspirationId ??= id(params.get('inspiration'));
  view.reflectionId = params.get('reflection') === 'open' ? 'open' : id(params.get('reflection'));
  if (!view.inspirationId) view.reflectionId = null;
  view.memberId = id(params.get('member'));
  view.find = params.get('find') === '1';
  view.compose = params.get('compose') === '1';
  const section = params.get('view');
  view.section = section === 'top' || section === 'field' || section === 'sky' ? section : view.inspirationId ? 'field' : 'top';
  const at = params.get('at');
  if (at && /^\d{1,16}$/.test(at)) { const date = Number(at); if (date <= 8_640_000_000_000_000) view.at = date; }
  return view;
}

export function viewHref(view: ViewLocation): string {
  if(view.conversationId)return `/chat/${encodeURIComponent(view.conversationId)}`;
  if(view.reviewId)return `/review/${encodeURIComponent(view.reviewId)}${view.reviewAnswerId&&view.reviewId!=='new'?`?thought=${encodeURIComponent(view.reviewAnswerId)}`:''}`;
  if(view.principleId)return `/principles/${encodeURIComponent(view.principleId)}${view.sharePrinciple?'/share':''}`;
  const path = view.wallId ? `/w/${encodeURIComponent(view.wallId)}${view.label ? `/${encodeURIComponent(view.label.trim().toLowerCase().replace(/\s+/g, '-'))}` : ''}` : '/';
  const params = new URLSearchParams();
  if (view.section !== 'top' || view.inspirationId) params.set('view', view.section);
  if (view.at !== null) params.set('at', String(Math.trunc(view.at)));
  if (view.memberId) params.set('member', view.memberId);
  if (view.inspirationId) params.set('inspiration', view.inspirationId);
  if (view.inspirationId && view.reflectionId) params.set('reflection', view.reflectionId);
  if (view.find) params.set('find', '1');
  if (view.compose) params.set('compose', '1');
  return path + (params.size ? `?${params}` : '');
}

export function resolveViewWall<T extends { id: string; name: string; kind: string }>(view: ViewLocation, walls: T[]): T | undefined {
  if (!view.wallId || view.wallId.toLowerCase() === 'me') return walls.find((wall) => wall.kind === 'self');
  const exact = walls.find((wall) => wall.id.toLowerCase() === view.wallId!.toLowerCase());
  if (exact || view.label !== undefined || /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(view.wallId)) return exact;
  return walls.find((wall) => encodeURIComponent(wall.name.trim().toLowerCase().replace(/\s+/g, '-')) === encodeURIComponent(view.wallId!.toLowerCase()));
}
