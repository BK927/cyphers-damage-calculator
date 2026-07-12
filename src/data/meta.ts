import raw from './meta.json'

/** 티어 코드: 0=전체, 1=에이스, 2=조커, 3=다이아, 4=골드, 5=실버, 6=브론즈 */
export type Tier = '0' | '1' | '2' | '3' | '4' | '5' | '6'
export const TIER_LABELS: Record<Tier, string> = {
  '0': '전체', '1': '에이스', '2': '조커', '3': '다이아', '4': '골드', '5': '실버', '6': '브론즈',
}
export const TIERS: Tier[] = ['0', '1', '2', '3', '4', '5', '6']

export interface MetaBuild {
  attack: number
  crit: number
  evade: number
  critDamage: number
  hp: number
  penetration?: number
  defenseReduction: number
  skillBoost: Record<string, number>
}

/** 킷 옵션 (착용 분포의 한 항목 + 파싱된 스탯, 킷은 skillBoost 없음) */
export interface KitOption {
  name: string
  icon?: string
  pct: number // 착용 비율 (0~1)
  attack: number
  crit: number
  evade: number
  critDamage: number
  hp: number
  penetration?: number
  defenseReduction: number
}

export type Role = 'dealer' | 'tank'
export type GearLevel = MetaBuild & { coin: number }

/** 아이템 정의 (티어 무관) */
export interface ItemDef {
  name: string
  icon: string
  levels: GearLevel[]
  total: MetaBuild
}

/** 해석된 장비 후보 = 아이템 정의 + 그 티어에서의 착용률 */
export interface GearItem extends ItemDef {
  pct: number
}

interface RawTier {
  pickRate: number
  samples: number
  role: Role
  gearSlots: Record<string, { k: string; pct: number }[]>
  attackKits: KitOption[]
  defenseKits: KitOption[]
}
interface RawChar {
  id: number
  name: string
  items: Record<string, ItemDef>
  tiers: Partial<Record<Tier, RawTier>>
}

export const metaBySlug = (raw as unknown as { characters: Record<string, RawChar> }).characters
export const metaScrapedAt: string = (raw as unknown as { scrapedAt: string }).scrapedAt

/** 티어 데이터 해석 결과 (폴백 반영) */
export interface TierView {
  pickRate: number
  samples: number
  role: Role
  gearSlots: Record<string, GearItem[]>
  attackKits: KitOption[]
  defenseKits: KitOption[]
}

const cache = new Map<string, TierView>()

/**
 * 캐릭터의 티어별 메타를 해석한다.
 * 해당 티어에 없는 슬롯/킷은 전체(0) 티어로 폴백.
 */
export function tierView(slug: string, tier: Tier): TierView {
  const key = `${slug}#${tier}`
  const hit = cache.get(key)
  if (hit) return hit
  const c = metaBySlug[slug]
  const empty: TierView = {
    pickRate: 0, samples: 0, role: 'dealer', gearSlots: {}, attackKits: [], defenseKits: [],
  }
  if (!c) return empty
  const base = c.tiers['0']
  const t = c.tiers[tier] ?? base
  if (!t || !base) return empty

  const resolve = (refs: { k: string; pct: number }[] | undefined): GearItem[] =>
    (refs ?? [])
      .map((r) => (c.items[r.k] ? { ...c.items[r.k], pct: r.pct } : null))
      .filter((x): x is GearItem => x != null)

  const gearSlots: Record<string, GearItem[]> = {}
  const slotNames = new Set([...Object.keys(base.gearSlots), ...Object.keys(t.gearSlots)])
  for (const slot of slotNames) {
    const own = resolve(t.gearSlots[slot])
    gearSlots[slot] = own.length ? own : resolve(base.gearSlots[slot])
    if (!gearSlots[slot].length) delete gearSlots[slot]
  }
  const view: TierView = {
    pickRate: t.pickRate ?? 0,
    samples: t.samples ?? 0,
    role: t.role ?? base.role,
    gearSlots,
    attackKits: t.attackKits?.length ? t.attackKits : base.attackKits,
    defenseKits: t.defenseKits?.length ? t.defenseKits : base.defenseKits,
  }
  cache.set(key, view)
  return view
}

/** 킷을 스탯으로 식별하는 시그니처 (스킨 중복 제거) */
export function kitSig(k: KitOption): string {
  return [k.attack, k.crit, k.critDamage, k.penetration ?? 0, k.defenseReduction, k.evade, k.hp].join('/')
}

/** 게임 전체(전체 티어 기준)에서 관측된 공격킷 옵션 */
function kitUniverse(pick: (t: RawTier) => KitOption[]): KitOption[] {
  const bySig = new Map<string, KitOption>()
  for (const c of Object.values(metaBySlug)) {
    const t = c.tiers['0']
    if (!t) continue
    for (const k of pick(t) ?? []) {
      const name = k.name.trim()
      const sig = kitSig(k)
      const existing = bySig.get(sig)
      if (!existing) bySig.set(sig, { ...k, name })
      else {
        if (k.pct > existing.pct) existing.pct = k.pct
        if (name.length < existing.name.length) existing.name = name
      }
    }
  }
  return [...bySig.values()]
}
export const attackKitOptions = kitUniverse((t) => t.attackKits)
export const defenseKitOptions = kitUniverse((t) => t.defenseKits)
