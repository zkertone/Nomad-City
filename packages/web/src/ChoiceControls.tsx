import type { GamePlayerView } from '@nomad-city-online/game-core';
export const basicAssets = ['orirock', 'originium', 'iron'] as const;
export const assetLabels: Record<string, string> = { orirock: '源岩', originium: '源石', iron: '异铁', 'pure-originium': '至纯源石', 'columbia-voucher': '金券' };
export function SlotChoice({ label, value, onChange, view, disabled, ids }: {
  readonly label: string; readonly value: string; readonly onChange: (id: string) => void;
  readonly view: GamePlayerView; readonly disabled: boolean; readonly ids?: readonly string[];
}) {
  return <label>{label}<select disabled={disabled} value={value} onChange={e => onChange(e.target.value)}>
    <option value="">请选择；无法执行的步骤可留空</option>
    {(ids ?? Object.keys(view.public.board.influenceBySlot)).map(id => <option key={id} value={id}>{id} · {view.public.board.influenceBySlot[id]?.ownerPlayerId.toUpperCase() ?? '空槽'}</option>)}
  </select></label>;
}
export function AssetChoice({ label, value, onChange, disabled }: { readonly label: string; readonly value: string; readonly onChange: (id: '' | typeof basicAssets[number]) => void; readonly disabled: boolean }) {
  return <label>{label}<select disabled={disabled} value={value} onChange={e => onChange(e.target.value as '' | typeof basicAssets[number])}>
    <option value="">请选择资源</option>{basicAssets.map(asset => <option key={asset} value={asset}>{assetLabels[asset]}</option>)}
  </select></label>;
}
