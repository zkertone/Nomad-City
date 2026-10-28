import type { ClientSnapshot } from './client.js';
import { getPlayGuide } from './play-guide.js';
export function PlayGuide({ state }: { readonly state: ClientSnapshot }) {
  const guide = getPlayGuide(state), preparation = ['role-removal', 'role-placement'].includes(state.game?.public.round?.stage ?? '');
  return <section className={`play-guide ${guide.tone}`} aria-label="当前操作指引" role="status" aria-live="polite">
    <div><span className="eyebrow">{guide.stage}</span><h2>{guide.title}</h2><p>{guide.detail}</p></div>
    <a className="guide-jump" href={preparation ? '#round-decision' : '#current-decision'}>前往操作区 ↓</a>
  </section>;
}
