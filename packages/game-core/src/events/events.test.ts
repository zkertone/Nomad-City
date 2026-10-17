import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import raw from './founders-base.json' with { type: 'json' };
import {
  FOUNDERS_EVENT_CATALOG, FOUNDERS_EVENT_CATALOG_HASH,
  foundersEventCatalogSchema, parseFoundersEventCatalog, validateFoundersEventCatalog,
  canonicalEventCatalogContent, computeEventCatalogHash,
  getFoundersEventCard, getFoundersEventCards,
} from './index.js';
import type { EventCatalog, EventEffect } from './types.js';

const readDoc = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
const review = readDoc('docs/Event-Cards-Review-2026-10-17.md');
const text = readDoc('docs/Event-Card-Text-2026-10-17.md');
const rows = review.split('\n').filter(line => /^\| [GYR]\d{2} \|/.test(line))
  .map(line => line.slice(1, -1).split('|').map(part => part.trim()));
const sections = [...text.matchAll(/^### ([GYR]\d{2}) (.+)\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)]
  .map(match => ({ id: match[1]!, title: match[2]!, body: match[3]! }));
const catalog = FOUNDERS_EVENT_CATALOG;
const copy = () => structuredClone(raw);
const hashInput = (value: typeof raw) => value as unknown as EventCatalog;
const assets: Record<string, 'orirock' | 'originium' | 'iron' | 'columbia-voucher' | 'pure-originium' | 'point'> = {
  源岩: 'orirock', 源石: 'originium', 异铁: 'iron', 金券: 'columbia-voucher', 至纯源石: 'pure-originium', 分: 'point',
};

describe('approved event documents, independently read in tests', () => {
  it('contains exactly 22 unique cards and 49 printed choices', () => {
    expect(rows).toHaveLength(22);
    expect(sections).toHaveLength(22);
    expect(new Set(catalog.cards.map(card => card.id)).size).toBe(22);
    expect(catalog.cards.reduce((sum, card) => sum + card.choices.length, 0)).toBe(49);
    expect(getFoundersEventCards('green')).toHaveLength(6);
    expect(getFoundersEventCards('yellow')).toHaveLength(10);
    expect(getFoundersEventCards('red')).toHaveLength(6);
  });

  it.each(rows)('%s preserves its title, marker, four-player mark and source', (id, title, marker, flag, ...rest) => {
    const card = getFoundersEventCard(id!);
    expect(card.title).toBe(title);
    expect(card.resourceMarker).toEqual({
      resource: assets[marker!.replace(' ×2', '')], harvestAmount: marker!.endsWith('×2') ? 2 : 1,
    });
    expect(card.hasFourPlayerMark).toBe(flag === '有');
    expect(card.sourceRef).toBe(rest.at(-1)!.split(' ')[0]);
  });

  it.each(sections)('$id retains the complete confirmed description and option narration', ({ id, title, body }) => {
    const card = getFoundersEventCard(id!);
    expect(card.title).toBe(title);
    expect(card.description).toBe(body!.split('选项叙事')[0]!.trim());
    expect(card.choices.map(choice => choice.narration)).toEqual(
      [...body!.matchAll(/^\d\. (.+)$/gm)].map(match => match[1]),
    );
  });

  // This parser reads the approved effect table, never the production JSON.
  const printedChoices = rows.flatMap(row => row.slice(4, -1).filter(cell => cell !== '—')
    .map((printed, index) => ({ id: `${row[0]}:${index + 1}`, printed, cardId: row[0]!, index })));
  it.each(printedChoices)('$id matches every printed amount, recipient, cost and placement scope', ({ printed, cardId, index }) => {
    const choice = getFoundersEventCard(cardId).choices[index]!;
    const effects: EventEffect[] = [];
    for (const clause of printed.split('；')) {
      for (const [, , amount, asset] of clause.matchAll(/(获得|\+)\s*(\d+)\s*(至纯源石|源岩|源石|异铁|金券|分)/g)) {
        effects.push({ kind: 'gain', recipient: clause.includes('所有对手') ? 'each-opponent' : 'actor',
          asset: assets[asset!]!, amount: Number(amount) });
      }
    }
    if (printed.includes('放置')) {
      effects.push({ kind: 'place-influence', amount: 1,
        scope: printed.includes('此资源点或相邻') ? 'event-node-or-incident-route'
          : printed.includes('此资源点相邻') ? 'incident-route' : 'standard' });
    }
    expect(choice.effects).toEqual(effects);
    const fee = printed.match(/^支付 (\d+) 金券/);
    expect(choice.cost).toEqual(fee ? { asset: 'columbia-voucher', amount: Number(fee[1]) } : null);
  });

  it('pins the bytes of both owner-confirmed source documents', () => {
    expect(createHash('sha256').update(review, 'utf8').digest('hex')).toBe(catalog.sources.reviewSha256);
    expect(createHash('sha256').update(text, 'utf8').digest('hex')).toBe(catalog.sources.textSha256);
    expect(catalog.sources.repositoryCommit).toBe('e29b00ee6285515e8a432ed18938bd07193598b7');
  });

  it('keeps E replacements and expansion-only fields out of the base catalog', () => {
    expect(catalog.cards.filter(card => card.title === '洞穴和遗迹')).toHaveLength(1);
    expect(catalog.cards.filter(card => card.title === '采集平台残骸')).toHaveLength(1);
    expect(catalog.cards.filter(card => card.hasFourPlayerMark).map(card => card.id)).toEqual(['G01', 'Y08', 'Y10', 'R01']);
    expect(catalog.cards.filter(card => card.resourceMarker.harvestAmount === 2).map(card => card.id)).toEqual(['R05', 'R06']);
    expect(catalog.cards.filter(card => card.resourceMarker.resource === 'pure-originium').map(card => card.id)).toEqual(['R01', 'R03', 'R04']);
  });

  it('does not multiply red card choice rewards by the harvest multiplier', () => {
    expect(getFoundersEventCard('R06').choices[0]!.effects).toEqual([
      { kind: 'gain', recipient: 'actor', asset: 'orirock', amount: 7 },
    ]);
  });
});

describe('schema and exact approved-content validation', () => {
  it('validates and parses the independent JSON module', () => {
    expect(validateFoundersEventCatalog(raw).success).toBe(true);
    expect(parseFoundersEventCatalog(raw)).toEqual(catalog);
  });
  const invalid: [string, (value: typeof raw) => void][] = [
    ['schema version', v => { v.schemaVersion = '2.0.0'; }],
    ['definition version', v => { v.definitionVersion = '2.0.0'; }],
    ['catalog ID', v => { v.catalogId = 'infected-events'; }],
    ['duplicate card ID', v => { v.cards[1]!.id = 'G01'; }],
    ['missing card', v => { v.cards.pop(); }],
    ['wrong color', v => { v.cards[0]!.color = 'red'; }],
    ['duplicate choice', v => { v.cards[0]!.choices[1]!.id = 'G01:1'; }],
    ['foreign choice', v => { v.cards[0]!.choices[0]!.id = 'R01:1'; }],
    ['negative reward', v => { v.cards[0]!.choices[0]!.effects[0]!.amount = -1; }],
    ['fractional reward', v => { v.cards[0]!.choices[0]!.effects[0]!.amount = 0.5; }],
    ['unsafe integer', v => { v.cards[0]!.choices[0]!.effects[0]!.amount = Number.MAX_SAFE_INTEGER + 1; }],
    ['empty narration', v => { v.cards[0]!.choices[0]!.narration = ' '; }],
    ['wrong marker quantity', v => { v.cards[0]!.resourceMarker.harvestAmount = 3; }],
    ['unknown resource', v => { v.cards[0]!.resourceMarker.resource = 'infection'; }],
    ['unknown source', v => { v.cards[0]!.sourceRef = 'S5'; }],
    ['invalid cost', v => { v.cards[10]!.choices[0]!.cost!.amount = 0; }],
    ['invalid placement quantity', v => { v.cards[10]!.choices[0]!.effects[0]!.amount = 2; }],
    ['invalid placement scope', v => { Object.assign(v.cards[10]!.choices[0]!.effects[0]!, { scope: 'anywhere' }); }],
  ];
  it.each(invalid)('rejects %s', (_label, change) => {
    const candidate = copy(); change(candidate);
    expect(validateFoundersEventCatalog(candidate).success).toBe(false);
  });
  it('rejects extra expansion metadata and client state', () => {
    expect(foundersEventCatalogSchema.safeParse({ ...raw, playerBalance: 999 }).success).toBe(false);
    const candidate = copy();
    Object.assign(candidate.cards[0]!, { enterpriseId: 'test' });
    expect(validateFoundersEventCatalog(candidate).success).toBe(false);
  });
  it('rejects a wrong digest and throws on parse failure', () => {
    const candidate = { ...raw, contentHash: `sha256:${'0'.repeat(64)}` };
    expect(validateFoundersEventCatalog(candidate).success).toBe(false);
    expect(() => parseFoundersEventCatalog(candidate)).toThrow('content hash mismatch');
  });
  it.each([
    ['reward amount', (v: typeof raw) => { v.cards[0]!.choices[0]!.effects[0]!.amount = 99; }],
    ['recipient', (v: typeof raw) => { Object.assign(v.cards[0]!.choices[0]!.effects[0]!, { recipient: 'each-opponent' }); }],
    ['narrative', (v: typeof raw) => { v.cards[0]!.description += '伪造'; }],
    ['four-player mark', (v: typeof raw) => { v.cards[0]!.hasFourPlayerMark = false; }],
    ['cost', (v: typeof raw) => { v.cards[10]!.choices[0]!.cost!.amount = 1; }],
    ['placement scope', (v: typeof raw) => { Object.assign(v.cards[13]!.choices[0]!.effects[0]!, { scope: 'standard' }); }],
    ['source hash', (v: typeof raw) => { v.sources.textSha256 = '0'.repeat(64); }],
    ['leading narration whitespace', (v: typeof raw) => { v.cards[0]!.choices[0]!.narration = ` ${v.cards[0]!.choices[0]!.narration}`; }],
  ] as const)('rejects rehashed tampering of %s', (_label, change) => {
    const candidate = copy(); change(candidate);
    candidate.contentHash = computeEventCatalogHash(hashInput(candidate));
    const result = validateFoundersEventCatalog(candidate);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues).toContain('Catalog differs from approved baseline');
  });
  it('parses a deeply frozen copy without modifying or freezing caller input', () => {
    const candidate = copy(); const snapshot = copy(); const parsed = parseFoundersEventCatalog(candidate);
    expect(candidate).toEqual(snapshot);
    expect(Object.isFrozen(candidate)).toBe(false);
    const frozenTree = (value: unknown): void => {
      if (value && typeof value === 'object') {
        expect(Object.isFrozen(value)).toBe(true);
        Object.values(value).forEach(frozenTree);
      }
    };
    frozenTree(parsed);
    expect(() => Reflect.set(parsed.cards[0]!, 'title', 'changed')).not.toThrow();
    expect(parsed.cards[0]!.title).toBe('废弃矿坑');
  });
});

describe('event-specific hash and lookup', () => {
  it('pins the catalog hash including narrative, sources, costs and effects', () => {
    expect(computeEventCatalogHash(catalog)).toBe(FOUNDERS_EVENT_CATALOG_HASH);
    expect(catalog.contentHash).toBe('sha256:aada5d9e8cb65c18897fca37eb0935e1cc4d38e848aab4fa6f3e64031d8e2ca7');
  });
  it('ignores only the top-level claimed contentHash', () => {
    expect(computeEventCatalogHash({ ...catalog, contentHash: 'ignored' })).toBe(catalog.contentHash);
  });
  it('keeps order-sensitive effect arrays distinct', () => {
    const candidate = copy(); candidate.cards[0]!.choices[0]!.effects.reverse();
    expect(computeEventCatalogHash(hashInput(candidate))).not.toBe(catalog.contentHash);
  });
  it('sorts object keys without changing array order or narrative string content', () => {
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]),
      );
      return value;
    };
    expect(canonicalEventCatalogContent(reverseKeys(catalog) as EventCatalog)).toBe(canonicalEventCatalogContent(catalog));
  });
  it.each(['constructor', '__proto__', 'Y11', 'E01', ''])('rejects unknown lookup %j', id => {
    expect(() => getFoundersEventCard(id)).toThrow(RangeError);
  });
  it('freezes query results and exposes no action executor', () => {
    expect(Object.isFrozen(getFoundersEventCards('yellow'))).toBe(true);
    expect(Object.isFrozen(getFoundersEventCard('Y05').choices[0]!.cost)).toBe(true);
  });
});
