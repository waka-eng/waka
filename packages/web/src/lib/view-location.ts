/** URLs carry identity and view metadata, never memory or search text. */
export type ViewSection = 'top' | 'field' | 'sky';
/**
 * WHAT IS OPEN OVER THE WORLD.
 *
 * Founder: "for your inspirations, after I click on it, I feel like I'm lost
 * how to go back to the previous screen, and I didn't realise clicking on top
 * of mind would leave me there. So maybe for your inspirations, this should
 * just be a modal that you can escape to go back to your top of mind."
 *
 * These were three ADDRESSES and are now three overlays, and the difference
 * is the whole fix. An address replaces the world: the world unmounts, the
 * camera forgets where it was, and the only way back is to find a control
 * that happens to name where you came from — which is why pressing "Top of
 * mind" to leave the archive felt like being moved rather than returning.
 * A parameter on the world's own address cannot do that. The pathname does
 * not change, so the world behind never unmounts, and going back is dropping
 * the parameter rather than navigating somewhere new.
 *
 * ONE AT A TIME, BY CONSTRUCTION. A union rather than three booleans,
 * because two of these open at once is not a state anyone meant and a
 * boolean trio makes it representable.
 */
/* `reading` ARRIVED 2026-10-11 — the top of mind's own page. Founder: "the
   speech bubble should show its top of mind at the moment, and the user can
   click on it to go to a new page where the user can engage with it." It is
   an `open` rather than a route for the same reason the other four are: the
   world stays mounted behind it, so leaving is a return rather than a trip. */
export type ViewOpen = 'saves' | 'claims' | 'principles' | 'conversations';
/* `'reading'` LEFT THIS LIST WITH THE PAGE IT NAMED. An address that reads
   cleanly and resolves to nothing is the worst of the two ways a link can
   die — this file already says so about `/review/:id` — so it is not parsed
   rather than parsed into a surface that no longer exists. */
const OPEN: readonly ViewOpen[] = ['saves', 'claims', 'principles', 'conversations'];
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
  principleId:string|null;
  sharePrinciple:boolean;
  conversationId:string|null;
  open: ViewOpen | null;
}
export const EMPTY_VIEW: ViewLocation = { wallId: null, section: 'top', inspirationId: null, reflectionId: null, memberId: null, at: null, find: false, compose: false,principleId:null,sharePrinciple:false,conversationId:null,open:null };
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
      view.conversationId=segments[1];view.principleId=view.conversationId==='new'?id(params.get('principle')):null;return view;
    /* `/review/:id` AND ITS `?thought=` DEEP LINK ARE GONE (2026-10-10),
       with the five components the founder folded into one correction field.
       An address that reads cleanly and resolves to nothing is the worst of
       the two ways a link can die, so it is not parsed: an old `/review/...`
       bookmark now returns null here and the app says the link is
       unavailable, in words, rather than opening an empty world. */
    } else if(segments[0]==='principles'&&id(segments[1]??null)&&(segments.length===2||segments.length===3&&segments[2]==='share')){
      view.principleId=segments[1];view.sharePrinciple=segments.length===3;view.section='sky';return view;
    } else return null;
  }
  view.inspirationId ??= id(params.get('inspiration'));
  view.reflectionId = params.get('reflection') === 'open' ? 'open' : id(params.get('reflection'));
  if (!view.inspirationId) view.reflectionId = null;
  view.memberId = id(params.get('member'));
  /* an empty or blank `open` (`?open=`, `?open=%20`) names no page: it is absent, not a dead link */
  const open = params.get('open')?.trim() || null;
  view.open = OPEN.find((name) => name === open) ?? null;
  /* AN `open` THIS BUILD DOES NOT KNOW IS A DEAD LINK, NOT A HOME LINK. It
     was dropped silently, so `?open=reading` — a page that went — opened
     plain home with nothing to say the page asked for was gone. Returning
     null routes it to the same "this view couldn't be opened" notice an old
     `/review/...` gets, for the reason given above. */
  if (open !== null && view.open === null) return null;
  view.find = params.get('find') === '1';
  view.compose = params.get('compose') === '1';
  const section = params.get('view');
  view.section = section === 'top' || section === 'field' || section === 'sky' ? section : view.inspirationId ? 'field' : 'top';
  const at = params.get('at');
  if (at && /^\d{1,16}$/.test(at)) { const date = Number(at); if (date <= 8_640_000_000_000_000) view.at = date; }
  return view;
}

export function viewHref(view: ViewLocation): string {
  if(view.conversationId)return `/chat/${encodeURIComponent(view.conversationId)}${view.conversationId==='new'&&view.principleId?`?principle=${encodeURIComponent(view.principleId)}`:''}`;
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
  if (view.open) params.set('open', view.open);
  return path + (params.size ? `?${params}` : '');
}

export function resolveViewWall<T extends { id: string; name: string; kind: string }>(view: ViewLocation, walls: T[]): T | undefined {
  if (!view.wallId || view.wallId.toLowerCase() === 'me') return walls.find((wall) => wall.kind === 'self');
  const exact = walls.find((wall) => wall.id.toLowerCase() === view.wallId!.toLowerCase());
  if (exact || view.label !== undefined || /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(view.wallId)) return exact;
  return walls.find((wall) => encodeURIComponent(wall.name.trim().toLowerCase().replace(/\s+/g, '-')) === encodeURIComponent(view.wallId!.toLowerCase()));
}
