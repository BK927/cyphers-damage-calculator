// 시뮬레이션 엔진 (장비 레벨 단위)
// - 장비 상태(GearState) = 슬롯별 {아이템 선택, 레벨}. 자동 세팅은 대세 빌드 순서로 생성.
// - 스킬별 기대 데미지 (평타/스킬/잡기/궁), 사이클·+잡기·+궁 합계
// - 상대: 역할 필드(입장률 가중, 같은 진행도) / 단일 상대(장비·킷 직접)
// - 우선 구매 특전: 손 3레벨→방어관통 +3%, 가슴 3레벨→체력 +5% (3번째 구매 시점부터)

import { critFactor } from './engine'
import { characters } from './data/characters'
import type { Character, Skill, SkillMode } from './types'
import { tierView, kitSig, type GearItem, type KitOption, type Tier } from './data/meta'
import { skillsBySlug } from './data/skills'
import { buildBySlug } from './data/buildorder'

const charBySlug: Record<string, Character> = Object.fromEntries(
  characters.map((c) => [c.slug, c]),
)

// ===== 스킬 =====

export type SkillClass = 'basic' | 'skill' | 'grab' | 'ult'
export function classifySkill(s: Skill): SkillClass {
  const cd = s.cooldown ?? 0
  if (cd >= 40) return 'ult' // 궁은 잡기 판정이 있어도 궁
  if (s.grab) return 'grab' // F키 전용 잡기 → 사이클 제외
  if (cd > 0 && cd < 1) return 'basic'
  return 'skill'
}

/** 캐릭터의 딜링 스킬 목록 (선택 모드 기준, 평타 → 스킬 → 잡기 → 궁 순) */
export function getSkills(slug: string, mode: SkillMode = '1st'): { skill: Skill; cls: SkillClass }[] {
  const order = { basic: 0, skill: 1, grab: 2, ult: 3 }
  return (skillsBySlug[slug] ?? [])
    .filter((s) => (s.modes ?? ['1st', '2nd']).includes(mode))
    .map((skill) => ({ skill, cls: classifySkill(skill) }))
    .sort((a, b) => order[a.cls] - order[b.cls])
}

/** 캐릭터가 두 모드(세컨궁)를 가지는가 */
export function hasTwoModes(slug: string): boolean {
  const s = skillsBySlug[slug] ?? []
  return s.some((x) => (x.modes ?? []).length === 1 && x.modes[0] === '2nd')
}

// ===== 장비 상태 =====

/** 슬롯 표시 순서 */
export const GEAR_SLOT_ORDER = [
  '손(공격)', '머리(치명)', '가슴(체력)', '허리(회피)', '다리(방어)', '발(이동)', '목',
  '장신구1', '장신구2', '장신구3', '장신구4',
]

export interface GearPick {
  item: number // gearSlots[slot] 후보 인덱스
  level: number // 0 ~ 후보.levels.length
}
export type GearState = Record<string, GearPick>

export function gearSlotsOf(slug: string, tier: Tier = '0'): Record<string, GearItem[]> {
  return tierView(slug, tier).gearSlots
}

/** 자동 세팅의 최대 진행도 = 대세 구매 시퀀스 길이 */
export function maxStageOf(slug: string, tier: Tier = '0'): number {
  const order = buildBySlug[slug]?.order
  if (order?.length) return order.length
  // 빌드순서 없는 캐릭(표본 부족): 전 슬롯 풀레벨 합
  return Object.values(gearSlotsOf(slug, tier)).reduce((s, c) => s + (c[0]?.levels.length ?? 0), 0)
}

/** 자동 세팅: 대세 구매 순서의 첫 stage개를 장비 상태로 (아이템 = 최다 착용) */
export function autoGear(slug: string, stage: number, tier: Tier = '0'): GearState {
  const gear: GearState = {}
  const order = buildBySlug[slug]?.order
  if (order?.length) {
    for (const o of order.slice(0, stage)) {
      const g = (gear[o.slot] ??= { item: 0, level: 0 })
      g.level = Math.max(g.level, o.level)
    }
  } else {
    // fallback: 슬롯 순서대로 풀레벨
    let left = stage
    for (const slot of GEAR_SLOT_ORDER) {
      const cand = gearSlotsOf(slug, tier)[slot]?.[0]
      if (!cand) continue
      const take = Math.min(left, cand.levels.length)
      if (take > 0) gear[slot] = { item: 0, level: take }
      left -= take
      if (left <= 0) break
    }
  }
  return gear
}

/** 풀빌드 장비 상태 */
export function fullGear(slug: string, tier: Tier = '0'): GearState {
  const gear: GearState = {}
  for (const [slot, cands] of Object.entries(gearSlotsOf(slug, tier))) {
    if (cands[0]) gear[slot] = { item: 0, level: cands[0].levels.length }
  }
  return gear
}

// 우선 구매 특전 (3번째 구매 시점부터)
const HAND_PERK_PEN = 0.03 // 장갑 3레벨 → 방어 관통력 +3%
const CHEST_PERK_HP = 0.05 // 셔츠 3레벨 → 체력 +5%

interface GearAcc {
  attack: number
  crit: number
  critDamage: number
  penetration: number
  evade: number
  hp: number
  hpMult: number
  skillBoost: Record<string, number>
  defenseParts: number[]
}

function gearStats(slug: string, gear: GearState, tier: Tier): GearAcc {
  const slots = gearSlotsOf(slug, tier)
  const acc: GearAcc = {
    attack: 0, crit: 0, critDamage: 0, penetration: 0, evade: 0, hp: 0, hpMult: 1,
    skillBoost: {}, defenseParts: [],
  }
  for (const [slot, pick] of Object.entries(gear)) {
    const cand = slots[slot]?.[pick.item] ?? slots[slot]?.[0]
    if (!cand) continue
    const n = Math.min(pick.level, cand.levels.length)
    for (let i = 0; i < n; i++) {
      const lv = cand.levels[i]
      acc.attack += lv.attack || 0
      acc.crit += lv.crit || 0
      acc.critDamage += lv.critDamage || 0
      acc.penetration += lv.penetration || 0
      acc.evade += lv.evade || 0
      acc.hp += lv.hp || 0
      if (lv.defenseReduction) acc.defenseParts.push(lv.defenseReduction)
      for (const [k, v] of Object.entries(lv.skillBoost || {})) {
        acc.skillBoost[k] = (acc.skillBoost[k] || 0) + v
      }
    }
  }
  if ((gear['손(공격)']?.level ?? 0) >= 3) acc.penetration += HAND_PERK_PEN
  if ((gear['가슴(체력)']?.level ?? 0) >= 3) acc.hpMult *= 1 + CHEST_PERK_HP
  return acc
}

// 목걸이 필터 — 공격형(방어% 없음)만 or 방어형(방어% 있음)만 반영
export type NeckFilter = 'attack' | 'defense'
/** expected 옵션: true=전체 착용 분포, {neck}=목 슬롯을 공격형/방어형으로 한정 후 재정규화 */
export type ExpectedOpt = boolean | { neck?: NeckFilter }
const isDefenseNeck = (c: GearItem) => (c.total.defenseReduction ?? 0) > 0

/**
 * 상대용 기대 장비 스탯 — 부위마다 해당 티어 착용률로 후보 전체를 가중 평균.
 * 가산 스탯(공격·체력·회피 등)은 정확한 기대값, 부위 방어%는 선형 근사.
 * neck 지정 시 목 슬롯은 공격형/방어형 후보만 남겨 그 안에서 재정규화.
 */
function gearStatsExpected(slug: string, gear: GearState, tier: Tier, neck?: NeckFilter): GearAcc {
  const slots = gearSlotsOf(slug, tier)
  const acc: GearAcc = {
    attack: 0, crit: 0, critDamage: 0, penetration: 0, evade: 0, hp: 0, hpMult: 1,
    skillBoost: {}, defenseParts: [],
  }
  for (const [slot, pick] of Object.entries(gear)) {
    let cands = slots[slot]
    if (!cands?.length) continue
    if (slot === '목' && neck) {
      cands = cands.filter((c) => (neck === 'defense' ? isDefenseNeck(c) : !isDefenseNeck(c)))
      if (!cands.length) continue // 해당 성향 목걸이 없음 → 목 슬롯 기여 없음
    }
    const totalPct = cands.reduce((s, c) => s + (c.pct || 0), 0) || 1
    let slotDef = 0
    for (const cand of cands) {
      const w = (cand.pct || 0) / totalPct
      if (w <= 0) continue
      const n = Math.min(pick.level, cand.levels.length)
      let noDef = 1
      for (let i = 0; i < n; i++) {
        const lv = cand.levels[i]
        acc.attack += w * (lv.attack || 0)
        acc.crit += w * (lv.crit || 0)
        acc.critDamage += w * (lv.critDamage || 0)
        acc.penetration += w * (lv.penetration || 0)
        acc.evade += w * (lv.evade || 0)
        acc.hp += w * (lv.hp || 0)
        if (lv.defenseReduction) noDef *= 1 - lv.defenseReduction
        for (const [k, v] of Object.entries(lv.skillBoost || {})) {
          acc.skillBoost[k] = (acc.skillBoost[k] || 0) + w * v
        }
      }
      slotDef += w * (1 - noDef)
    }
    if (slotDef > 0) acc.defenseParts.push(slotDef)
  }
  if ((gear['손(공격)']?.level ?? 0) >= 3) acc.penetration += HAND_PERK_PEN
  if ((gear['가슴(체력)']?.level ?? 0) >= 3) acc.hpMult *= 1 + CHEST_PERK_HP
  return acc
}

// ===== 공격자/방어자 프로필 =====

export interface Attacker {
  attack: number
  crit: number
  critDamage: number // fraction (0.05)
  penetration: number
  skillBoost: Record<string, number> // 스킬명 → 추가공격력 %
}
export interface Defender {
  reduction: number
  evade: number
}

function combineDefense(parts: number[]): number {
  return 1 - parts.reduce((acc, p) => acc * (1 - Math.max(0, p)), 1)
}

/** expected 옵션에 따라 정확값 / 기대값(+목 필터) 스탯을 계산 */
function resolveGear(slug: string, gear: GearState, tier: Tier, expected: ExpectedOpt): GearAcc {
  if (!expected) return gearStats(slug, gear, tier)
  const neck = typeof expected === 'object' ? expected.neck : undefined
  return gearStatsExpected(slug, gear, tier, neck)
}

export function attackerFrom(slug: string, gear: GearState, kit: KitOption | null, tier: Tier = '0', expected: ExpectedOpt = false): Attacker {
  const base = charBySlug[slug]
  const g = resolveGear(slug, gear, tier, expected)
  return {
    attack: (base?.attack ?? 0) + g.attack + (kit?.attack ?? 0),
    crit: (base?.crit ?? 0) + g.crit + (kit?.crit ?? 0),
    critDamage: (g.critDamage + (kit?.critDamage ?? 0)) / 100,
    penetration: g.penetration + (kit?.penetration ?? 0),
    skillBoost: g.skillBoost,
  }
}

export function defenderFrom(slug: string, gear: GearState, kit: KitOption | null, tier: Tier = '0', expected: ExpectedOpt = false): Defender {
  const base = charBySlug[slug]
  const g = resolveGear(slug, gear, tier, expected)
  return {
    reduction: combineDefense([(base?.defense ?? 0) / 100, ...g.defenseParts, kit?.defenseReduction ?? 0]),
    evade: (base?.evade ?? 0) + g.evade + (kit?.evade ?? 0),
  }
}

export function hpFrom(slug: string, gear: GearState, kit: KitOption | null = null, tier: Tier = '0', expected: ExpectedOpt = false): number {
  const base = charBySlug[slug]
  const g = resolveGear(slug, gear, tier, expected)
  const hp = (base?.hp ?? 0) + g.hp + (kit?.hp ?? 0)
  return hp * g.hpMult
}

// ===== 상대(타깃) =====

/** 필드 구성원 — slug/kitName은 근거 표시용 라벨 */
export interface FieldItem {
  w: number
  def: Defender
  hp: number
  slug?: string
  kitName?: string
}
export type Target =
  | { kind: 'single'; def: Defender; hp: number }
  | { kind: 'field'; items: FieldItem[]; totalW: number }

/** 결과 필드 종류: 딜러 / 방탱(방어킷) / 회탱(회피킷) */
export type FieldKind = 'dealer' | 'tankArmor' | 'tankEvade'
export const FIELD_KINDS: FieldKind[] = ['dealer', 'tankArmor', 'tankEvade']
const isEvadeKit = (k: KitOption | null) => !!k && (k.evade ?? 0) > 0 // 플래쉬·실피드·닷지 = 회피 성향

/**
 * 캐릭터의 딜러 비율 — 목 슬롯 후보 중 공격형 목걸이(방어% 없음) 착용률 ÷ 전체 목 착용률.
 * 목 후보가 없으면 role로 폴백(딜러=1, 탱커=0). 결과는 항상 0~1.
 */
export function dealerRatio(slug: string, tier: Tier = '0'): number {
  const neck = gearSlotsOf(slug, tier)['목']
  const fallback = () => (tierView(slug, tier).role === 'dealer' ? 1 : 0)
  if (!neck?.length) return fallback()
  let atk = 0, tot = 0
  for (const c of neck) {
    const w = c.pct || 0
    tot += w
    if (!isDefenseNeck(c)) atk += w
  }
  return tot > 0 ? atk / tot : fallback()
}

/**
 * 서브필드 타깃 — 입장률 가중, 각 상대도 같은 진행도의 자동 세팅.
 * 탱커는 방어킷 착용 분포로 가중을 나눔(방탱/회탱). 두 서브필드 합 = 원래 탱커 필드.
 */
export function subFieldTarget(kind: FieldKind, stage: number, tier: Tier = '0', excludeSlug?: string): Target {
  const items: FieldItem[] = []
  for (const c of characters) {
    const m = tierView(c.slug, tier)
    if (c.slug === excludeSlug || (m.pickRate ?? 0) <= 0) continue
    const dr = dealerRatio(c.slug, tier)
    const gear = autoGear(c.slug, stage, tier)
    if (kind === 'dealer') {
      const base = m.pickRate * dr
      if (base <= 0) continue
      const dks = m.defenseKits?.length ? m.defenseKits : []
      if (!dks.length) {
        items.push({ w: base, def: defenderFrom(c.slug, gear, null, tier, { neck: 'attack' }), hp: hpFrom(c.slug, gear, null, tier, { neck: 'attack' }), slug: c.slug })
        continue
      }
      // 방어킷 착용 분포대로 각 조합을 개별 상대로 분해 (Σw 보존)
      const totalPct = dks.reduce((s, k) => s + (k.pct ?? 0), 0) || 1
      for (const kit of dks) {
        const w = base * ((kit.pct ?? 0) / totalPct)
        if (w > 0) items.push({ w, def: defenderFrom(c.slug, gear, kit, tier, { neck: 'attack' }), hp: hpFrom(c.slug, gear, kit, tier, { neck: 'attack' }), slug: c.slug, kitName: kit.name })
      }
      continue
    }
    const tankBase = m.pickRate * (1 - dr)
    if (tankBase <= 0) continue
    const dks = m.defenseKits?.length ? m.defenseKits : []
    if (!dks.length) {
      if (kind === 'tankArmor') items.push({ w: tankBase, def: defenderFrom(c.slug, gear, null, tier, { neck: 'defense' }), hp: hpFrom(c.slug, gear, null, tier, { neck: 'defense' }), slug: c.slug })
      continue
    }
    const totalPct = dks.reduce((s, k) => s + (k.pct ?? 0), 0) || 1
    for (const kit of dks) {
      const evade = isEvadeKit(kit)
      if (kind === 'tankEvade' ? !evade : evade) continue
      const w = tankBase * ((kit.pct ?? 0) / totalPct)
      if (w > 0) items.push({ w, def: defenderFrom(c.slug, gear, kit, tier, { neck: 'defense' }), hp: hpFrom(c.slug, gear, kit, tier, { neck: 'defense' }), slug: c.slug, kitName: kit.name })
    }
  }
  return { kind: 'field', items, totalW: items.reduce((s, o) => s + o.w, 0) || 1 }
}

/** 여러 필드 타깃을 하나로 합침 (탱커=방탱+회탱, 종합=전체). 가중치는 그대로 이어붙임 */
export function mergeFields(...ts: Target[]): Target {
  const items = ts.flatMap((t) => (t.kind === 'field' ? t.items : []))
  return { kind: 'field', items, totalW: items.reduce((s, o) => s + o.w, 0) || 1 }
}

/** 단일 상대 (수동 모드 1:1) */
export function singleTarget(oppSlug: string, oppGear: GearState, oppKit: KitOption | null, tier: Tier = '0'): Target {
  return {
    kind: 'single',
    def: defenderFrom(oppSlug, oppGear, oppKit, tier),
    hp: hpFrom(oppSlug, oppGear, oppKit, tier),
  }
}

// ===== 데미지 계산 =====

/** 스킬 1개의 데미지 — 기대/최악/최대 (치명·회피 대결의 분포) */
export interface DmgParts { exp: number; min: number; max: number }
export function skillDamageParts(skill: Skill, atk: Attacker, def: Defender): DmgParts {
  const boost = (atk.skillBoost[skill.name] ?? 0) / 100
  const armor = skill.coeff.대인 ?? 1
  let raw = 0
  for (const h of skill.hits) raw += h.fixed + h.percent * atk.attack
  const base = raw * armor * (1 + boost)
  const afterDef = Math.max(0, base * (1 - def.reduction * (1 - atk.penetration)))
  const cf = critFactor(atk.crit, def.evade, atk.critDamage)
  return { exp: afterDef * cf.factor, min: afterDef * cf.minMul, max: afterDef * cf.maxMul }
}
/** 스킬 1개의 기대 데미지 (랭킹용) */
export function skillDamage(skill: Skill, atk: Attacker, def: Defender): number {
  return skillDamageParts(skill, atk, def).exp
}

function evalSkill(skill: Skill, atk: Attacker, t: Target): DmgParts {
  if (t.kind === 'single') return skillDamageParts(skill, atk, t.def)
  let exp = 0, min = 0, max = 0
  for (const it of t.items) {
    const d = skillDamageParts(skill, atk, it.def)
    exp += it.w * d.exp; min += it.w * d.min; max += it.w * d.max
  }
  return { exp: exp / t.totalW, min: min / t.totalW, max: max / t.totalW }
}
export function targetHP(t: Target): number {
  if (t.kind === 'single') return t.hp
  let s = 0
  for (const it of t.items) s += it.w * it.hp
  return s / t.totalW
}

export interface SkillDamage {
  skill: Skill
  cls: SkillClass
  damage: number // 기대
  damageMin: number
  damageMax: number
}
export interface SimResult {
  skills: SkillDamage[]
  cycle: number // 평타+스킬 합 (잡기·궁 제외)
  cycleMin: number
  cycleMax: number
  grab: number // 잡기 합
  ult: number // 최대 궁 (기대값 기준)
  ultMin: number
  ultMax: number
  cyclePlusGrab: number
  cyclePlusUlt: number
  cyclePlusUltMin: number
  cyclePlusUltMax: number
  hp: number
}

export function simulate(slug: string, atk: Attacker, t: Target, mode: SkillMode = '1st'): SimResult {
  const skills = getSkills(slug, mode).map(({ skill, cls }) => {
    const d = evalSkill(skill, atk, t)
    return { skill, cls, damage: d.exp, damageMin: d.min, damageMax: d.max }
  })
  const isCycle = (s: SkillDamage) => s.cls === 'basic' || s.cls === 'skill'
  const sum = (pred: (s: SkillDamage) => boolean, key: 'damage' | 'damageMin' | 'damageMax') =>
    skills.filter(pred).reduce((a, s) => a + s[key], 0)
  const cycle = sum(isCycle, 'damage')
  const cycleMin = sum(isCycle, 'damageMin')
  const cycleMax = sum(isCycle, 'damageMax')
  const grab = sum((s) => s.cls === 'grab', 'damage')
  // 궁: 기대값 최대인 궁 스킬을 채택, 그 최악/최대를 사용
  const bestUlt = skills
    .filter((s) => s.cls === 'ult')
    .reduce<SkillDamage | null>((best, s) => (s.damage > (best?.damage ?? -1) ? s : best), null)
  const ult = bestUlt?.damage ?? 0
  const ultMin = bestUlt?.damageMin ?? 0
  const ultMax = bestUlt?.damageMax ?? 0
  return {
    skills,
    cycle, cycleMin, cycleMax,
    grab,
    ult, ultMin, ultMax,
    cyclePlusGrab: cycle + grab,
    cyclePlusUlt: cycle + ult,
    cyclePlusUltMin: cycleMin + ultMin,
    cyclePlusUltMax: cycleMax + ultMax,
    hp: targetHP(t),
  }
}

/** 공격킷 후보 랭킹 — 타깃별 (사이클+궁) 점수 + 합계 기준 내림차순 */
export function rankKits(
  slug: string,
  gear: GearState,
  options: KitOption[],
  targets: Target[],
  mode: SkillMode,
  tier: Tier = '0',
) {
  const scored = options.map((kit) => {
    const atk = attackerFrom(slug, gear, kit, tier)
    const per = targets.map((t) => simulate(slug, atk, t, mode).cyclePlusUlt)
    return { kit, per, total: per.reduce((a, b) => a + b, 0) }
  })
  scored.sort((a, b) => b.total - a.total)
  return scored
}

// ===== 방어킷 추천 (받는 피해 기준) =====

/** 나를 때리는 상대 1명 — 가중 w, 기대 세팅·기대 공격킷, 잡기 제외한 사이클+궁 스킬 */
export interface IncomingAttacker {
  w: number
  atk: Attacker
  skills: { skill: Skill; cls: SkillClass }[]
  slug?: string // 위협 TOP 표시용 라벨
}

/**
 * 서브필드 공격자 목록 — subFieldTarget과 같은 순회/가중이되 각 상대를 '공격자'로 구성.
 * 딜러=입장률, 탱커=입장률×방어킷비율로 방탱/회탱 분할. 각 상대는 기대 세팅+기대 공격킷.
 */
export function incomingField(kind: FieldKind, stage: number, tier: Tier = '0', excludeSlug?: string): IncomingAttacker[] {
  const out: IncomingAttacker[] = []
  for (const c of characters) {
    const m = tierView(c.slug, tier)
    if (c.slug === excludeSlug || (m.pickRate ?? 0) <= 0) continue
    const dr = dealerRatio(c.slug, tier)
    const gear = autoGear(c.slug, stage, tier)
    // 딜러 공격자=공격형 목걸이 기대값, 탱커 공격자=방어형 목걸이
    const neck: NeckFilter = kind === 'dealer' ? 'attack' : 'defense'
    const atkBase = attackerFrom(c.slug, gear, null, tier, { neck }) // 킷 없는 기준 → 공격킷별로 파생
    const aks = m.attackKits?.length ? m.attackKits : []
    const akTotal = aks.reduce((s, k) => s + (k.pct ?? 0), 0) || 1
    // 공격킷 착용 분포별 공격자 [가중배수, 공격자] (킷 없으면 기준 1개, Σ배수=1)
    const atkVariants: [number, Attacker][] = aks.length
      ? aks.map((k) => [(k.pct ?? 0) / akTotal, {
          ...atkBase,
          attack: atkBase.attack + (k.attack ?? 0),
          crit: atkBase.crit + (k.crit ?? 0),
          critDamage: atkBase.critDamage + (k.critDamage ?? 0) / 100,
          penetration: atkBase.penetration + (k.penetration ?? 0),
        }])
      : [[1, atkBase]]
    const skills = getSkills(c.slug, '1st').filter((s) => s.cls !== 'grab') // 잡기 제외 → 사이클+궁
    // 그룹 가중에 각 공격킷 비율을 곱해 분해 push
    const push = (base: number) => {
      if (base <= 0) return
      for (const [akShare, atk] of atkVariants) {
        const w = base * akShare
        if (w > 0) out.push({ w, atk, skills, slug: c.slug })
      }
    }
    if (kind === 'dealer') { push(m.pickRate * dr); continue }
    const tankBase = m.pickRate * (1 - dr)
    if (tankBase <= 0) continue
    const dks = m.defenseKits?.length ? m.defenseKits : []
    if (!dks.length) { if (kind === 'tankArmor') push(tankBase); continue }
    const totalPct = dks.reduce((s, k) => s + (k.pct ?? 0), 0) || 1
    for (const kit of dks) {
      const evade = isEvadeKit(kit)
      if (kind === 'tankEvade' ? !evade : evade) continue
      push(tankBase * ((kit.pct ?? 0) / totalPct))
    }
  }
  return out
}

/**
 * 나를 때리는 공격자 목록이 넣는 받는 피해 — 그룹(입장률) 가중 평균.
 * 각 공격자는 사이클(평타+스킬) 합 + 최대 기대 궁 1개. 피격에선 min=최소피해(유리)/max=최대피해(위험).
 * top5 = 개인 사이클+궁(기대) 상위 5명 (slug당 최대 1개).
 */
export interface IncomingResult {
  cycle: DmgParts // 평타+스킬 (잡기·궁 제외)
  cyclePlusUlt: DmgParts // 사이클 + 최대 궁
  top5: { slug: string; dmg: number }[]
}

export function incomingSim(attackers: IncomingAttacker[], myDef: Defender): IncomingResult {
  const totalW = attackers.reduce((s, a) => s + a.w, 0) || 1
  let cE = 0, cN = 0, cX = 0, uE = 0, uN = 0, uX = 0
  const byChar = new Map<string, { sw: number; swd: number }>() // slug → 가중합(개인 사이클+궁 기대)
  for (const a of attackers) {
    let cyE = 0, cyN = 0, cyX = 0, ulE = 0, ulN = 0, ulX = 0
    for (const { skill, cls } of a.skills) {
      const d = skillDamageParts(skill, a.atk, myDef)
      if (cls === 'ult') {
        if (d.exp > ulE) { ulE = d.exp; ulN = d.min; ulX = d.max } // 기대값 최대인 궁 채택
      } else {
        cyE += d.exp; cyN += d.min; cyX += d.max // 평타·스킬 (잡기는 이미 제외)
      }
    }
    cE += a.w * cyE; cN += a.w * cyN; cX += a.w * cyX
    uE += a.w * (cyE + ulE); uN += a.w * (cyN + ulN); uX += a.w * (cyX + ulX)
    if (a.slug) {
      const indiv = cyE + ulE // 킷별로 분해돼 slug당 여러 항목 → 가중 평균으로 기대 위협 유지
      const e = byChar.get(a.slug) ?? { sw: 0, swd: 0 }
      e.sw += a.w; e.swd += a.w * indiv
      byChar.set(a.slug, e)
    }
  }
  const top5 = [...byChar.entries()]
    .map(([slug, v]) => ({ slug, dmg: v.sw > 0 ? v.swd / v.sw : 0 }))
    .sort((a, b) => b.dmg - a.dmg)
    .slice(0, 5)
  return {
    cycle: { exp: cE / totalW, min: cN / totalW, max: cX / totalW },
    cyclePlusUlt: { exp: uE / totalW, min: uN / totalW, max: uX / totalW },
    top5,
  }
}

/** 방어킷 후보 랭킹 — 필드가 내게 넣는 사이클+궁으로 생존 사이클 수 산정 (클수록 좋음) */
export interface DefKitRank {
  kit: KitOption
  per: [number, number] // 딜러 / 탱커 생존 사이클 수 (탱커 = 방탱+회탱 병합)
  total: number // 필드 가중 종합 생존 사이클 수
}

export function rankDefKits(
  slug: string,
  gear: GearState,
  options: KitOption[],
  stage: number,
  tier: Tier = '0',
): DefKitRank[] {
  // 공격자 목록은 방어킷 후보와 무관 → 후보 루프 밖에서 1회만 구성
  const dealer = incomingField('dealer', stage, tier, slug)
  const tank = [...incomingField('tankArmor', stage, tier, slug), ...incomingField('tankEvade', stage, tier, slug)]
  const all = [...dealer, ...tank]
  const groups = [dealer, tank]

  const scored = options.map((kit) => {
    const def = defenderFrom(slug, gear, kit, tier) // 내 장비는 정확값
    const myHp = hpFrom(slug, gear, kit, tier)
    const surv = (atks: IncomingAttacker[]) => {
      const dmg = incomingSim(atks, def).cyclePlusUlt.exp
      return dmg > 0 ? myHp / dmg : Infinity
    }
    const per = groups.map(surv) as [number, number]
    const total = surv(all)
    return { kit, per, total }
  })
  scored.sort((a, b) => b.total - a.total)
  return scored
}

// ===== 강화 순서 추천 (upgrade-order optimizer) =====

// 강화 1회당 캐릭터 레벨 상승 (부위별). 누락 슬롯은 +1 폴백.
const LEVEL_GAIN: Record<string, number> = {
  '손(공격)': 4, '가슴(체력)': 4,
  '머리(치명)': 3, '허리(회피)': 3, '다리(방어)': 3, '발(이동)': 3,
  '목': 2, '장신구1': 1, '장신구2': 1, '장신구3': 1, '장신구4': 1, '장신구ALL': 1,
}
const reqLevel = (itemLevel: number) => 10 * (itemLevel - 1) // L강 구매 필요 캐릭터 레벨
// 유틸 슬롯(이동속도) — 딜·생존 목표값에 기여하지 않아 최적화가 항상 뒤로 미룸
// → 구매 시점을 랭커 실구매 위치에 고정(pin)해 유틸 가치를 실제 행동에서 빌려옴
const UTIL_SLOT = '발(이동)'
// 슬롯별 필요 레벨 예외 — 신발 2강은 20레벨 (기본 규칙 10×(L−1)의 예외)
const REQ_OVERRIDE: Record<string, number[]> = { [UTIL_SLOT]: [0, 20] }
const reqLevelOf = (slot: string, itemLevel: number) => REQ_OVERRIDE[slot]?.[itemLevel - 1] ?? reqLevel(itemLevel)

// 캐릭터 레벨 = 산 강화의 누적 (부위별 상승량 합)
function charLevel(gear: GearState): number {
  let lv = 0
  for (const [slot, p] of Object.entries(gear)) lv += (LEVEL_GAIN[slot] ?? 1) * (p.level || 0)
  return lv
}

export interface UpgradeStep {
  slot: string
  level: number // 이 강화 후 그 슬롯 레벨
  coin: number // 이번 강화 비용
  cumCoin: number // 누적 비용
  value: number // 강화 적용 후 목표값
  gain: number // Δ = 적용 후 − 적용 전
  per: number[] // 그룹별 값 — 공격: [딜러,방탱,회탱] 딜 / 방어: [딜러,탱커] 생존 컷
  noUlt?: number // 공격 전용: 궁 제외(사이클만) 종합 딜
  perNoUlt?: number[] // 공격 전용: 궁 제외 그룹별 딜
}

/**
 * 강화 순서 최적화 — 빈 장비에서 슬롯별 1레벨씩 사며 각 시점 최선 후보를 채택.
 * greedy=절대 이득(Δ) 최대(한 방 큰 것 먼저), efficiency=코인당 이득(Δ/코인) 최대(면적 근사).
 * L강 구매 필요 캐릭 레벨 = 10×(L−1), 캐릭 레벨 = 강화 누적(부위별 LEVEL_GAIN).
 * 상대(필드/타깃)는 풀빌드 기준(refStage)으로 루프 밖에서 1회만 구성해 재사용.
 */
// 강화 목표값 — defense=생존 사이클 수(HP/받는피해), attack=한 사이클+궁 기대딜.
// value=종합(선택 기준), per=그룹별(공격: 딜러/방탱/회탱 딜, 방어: 딜러/탱커 생존 컷).
// 상대(필드/타깃)는 풀빌드 기준으로 1회만 구성해 클로저로 재사용(평가가 필드 전체를 순회하므로).
function upgradeEvaluators(
  slug: string,
  kind: 'attack' | 'defense',
  kit: KitOption | null,
  tier: Tier,
): {
  value: (gear: GearState) => number
  snap: (gear: GearState) => Pick<UpgradeStep, 'per' | 'noUlt' | 'perNoUlt'> // 채택된 단계의 그룹별·궁제외 값
} {
  const refStage = maxStageOf(slug, tier)
  if (kind === 'defense') {
    const dealer = incomingField('dealer', refStage, tier, slug)
    const tank = [...incomingField('tankArmor', refStage, tier, slug), ...incomingField('tankEvade', refStage, tier, slug)]
    const all = [...dealer, ...tank]
    const surv = (atks: IncomingAttacker[], gear: GearState) => {
      const dmg = incomingSim(atks, defenderFrom(slug, gear, kit, tier)).cyclePlusUlt.exp
      return dmg > 0 ? hpFrom(slug, gear, kit, tier) / dmg : 1e9
    }
    return { value: (g) => surv(all, g), snap: (g) => ({ per: [surv(dealer, g), surv(tank, g)] }) }
  }
  const ts = [
    subFieldTarget('dealer', refStage, tier, slug),
    subFieldTarget('tankArmor', refStage, tier, slug),
    subFieldTarget('tankEvade', refStage, tier, slug),
  ]
  const merged = mergeFields(...ts)
  const sim1 = (t: Target, gear: GearState) => simulate(slug, attackerFrom(slug, gear, kit, tier), t, '1st')
  return {
    value: (g) => sim1(merged, g).cyclePlusUlt,
    snap: (g) => {
      const groups = ts.map((t) => sim1(t, g))
      return {
        per: groups.map((r) => r.cyclePlusUlt),
        noUlt: sim1(merged, g).cycle,
        perNoUlt: groups.map((r) => r.cycle),
      }
    },
  }
}

export function optimizeUpgradeOrder(
  slug: string,
  kind: 'attack' | 'defense',
  kit: KitOption | null,
  tier: Tier,
  mode: 'greedy' | 'efficiency',
): UpgradeStep[] {
  const slots = gearSlotsOf(slug, tier)
  const { value, snap } = upgradeEvaluators(slug, kind, kit, tier)

  // 신발(유틸) 핀: 랭커 실구매 순서에서 발(이동)이 등장하는 위치 (없으면 핀 없음 → 기존 동작)
  const pins = (buildBySlug[slug]?.order ?? [])
    .map((o, i) => ({ slot: o.slot, level: o.level, at: i }))
    .filter((o) => o.slot === UTIL_SLOT)
  let pinIdx = 0

  const gear: GearState = {}
  const steps: UpgradeStep[] = []
  let cumCoin = 0
  let base = value(gear) // 현 시점 값

  const buy = (slot: string, level: number, coin: number, val: number, gain: number) => {
    gear[slot] = { item: 0, level }
    cumCoin += coin
    steps.push({ slot, level, coin, cumCoin, value: val, gain, ...snap(gear) })
    base = val
  }

  for (;;) {
    const lv = charLevel(gear)
    // 핀 도달 시 신발 우선 구매 (레벨 요건 미달이면 충족될 때까지 자연 지연)
    const pin = pins[pinIdx]
    const shoe = slots[UTIL_SLOT]?.[0]
    if (pin && shoe && steps.length >= pin.at && pin.level <= shoe.levels.length && lv >= reqLevelOf(UTIL_SLOT, pin.level)) {
      const coin = shoe.levels[pin.level - 1].coin
      const val = value({ ...gear, [UTIL_SLOT]: { item: 0, level: pin.level } })
      buy(UTIL_SLOT, pin.level, coin, val, val - base)
      pinIdx++
      continue
    }
    let best: { slot: string; level: number; coin: number; val: number; gain: number; score: number } | null = null
    for (const [slot, cands] of Object.entries(slots)) {
      if (slot === UTIL_SLOT && pins.length) continue // 신발은 핀으로만 구매
      const item = cands[0]
      if (!item) continue
      const cur = gear[slot]?.level ?? 0
      const next = cur + 1
      if (next > item.levels.length) continue // 이미 최대
      if (lv < reqLevelOf(slot, next)) continue // 구매 필요 레벨 미달
      const coin = item.levels[next - 1].coin
      const trial: GearState = { ...gear, [slot]: { item: 0, level: next } }
      const val = value(trial)
      const gain = val - base
      const score = mode === 'greedy' ? gain : gain / (coin || 1)
      if (!best || score > best.score) best = { slot, level: next, coin, val, gain, score }
    }
    if (!best) {
      // 다른 슬롯이 모두 끝났는데 신발 핀이 남았으면 위치 무관하게 소진
      if (pin && shoe && pin.level <= shoe.levels.length && lv >= reqLevelOf(UTIL_SLOT, pin.level)) {
        const coin = shoe.levels[pin.level - 1].coin
        const val = value({ ...gear, [UTIL_SLOT]: { item: 0, level: pin.level } })
        buy(UTIL_SLOT, pin.level, coin, val, val - base)
        pinIdx++
        continue
      }
      break // 전 슬롯 최대 or 필요 레벨 미달
    }
    buy(best.slot, best.level, best.coin, best.val, best.gain)
  }
  return steps
}

/** 강화 순서(공격)의 원킬 기준 HP — 종합 + 그룹별(딜러/방탱/회탱) 풀빌드 상대 평균 HP */
export function upgradeGroupHps(slug: string, tier: Tier = '0'): { overall: number; per: number[] } {
  const refStage = maxStageOf(slug, tier)
  const ts = [
    subFieldTarget('dealer', refStage, tier, slug),
    subFieldTarget('tankArmor', refStage, tier, slug),
    subFieldTarget('tankEvade', refStage, tier, slug),
  ]
  return { overall: targetHP(mergeFields(...ts)), per: ts.map((t) => targetHP(t)) }
}

/** 주어진 강화 순서(랭커 빌드 등)를 그대로 재생해 각 시점 값 곡선을 계산 (비교용). */
export function evalUpgradePath(
  slug: string,
  kind: 'attack' | 'defense',
  kit: KitOption | null,
  tier: Tier,
  path: { slot: string; level: number }[],
): UpgradeStep[] {
  const slots = gearSlotsOf(slug, tier)
  const { value, snap } = upgradeEvaluators(slug, kind, kit, tier)
  const gear: GearState = {}
  const steps: UpgradeStep[] = []
  let cumCoin = 0
  let base = value(gear)
  for (const p of path) {
    const item = slots[p.slot]?.[0]
    if (!item || p.level < 1 || p.level > item.levels.length) continue // 장비 외(소모품 등) 스킵
    gear[p.slot] = { item: 0, level: p.level }
    const coin = item.levels[p.level - 1].coin
    cumCoin += coin
    const val = value(gear)
    steps.push({ slot: p.slot, level: p.level, coin, cumCoin, value: val, gain: val - base, ...snap(gear) })
    base = val
  }
  return steps
}

// ===== 킷 착용률 (필드 전체, 입장률 가중) =====

const usageCache = new Map<string, Map<string, number>>()

/** 전 캐릭 순회 — 각 킷을 kitSig로 키잉해 (입장률 × 킷비율) 누적, 전체 합으로 정규화한 비율(0~1) */
export function kitUsage(tier: Tier, kind: 'attack' | 'defense'): Map<string, number> {
  const cacheKey = `${tier}#${kind}`
  const hit = usageCache.get(cacheKey)
  if (hit) return hit
  const usage = new Map<string, number>()
  let grand = 0
  for (const c of characters) {
    const m = tierView(c.slug, tier)
    if ((m.pickRate ?? 0) <= 0) continue
    const kits = kind === 'attack' ? m.attackKits : m.defenseKits
    const totalPct = kits.reduce((s, k) => s + (k.pct ?? 0), 0) || 1
    for (const k of kits) {
      const share = m.pickRate * ((k.pct ?? 0) / totalPct)
      if (share <= 0) continue
      const sig = kitSig(k)
      usage.set(sig, (usage.get(sig) ?? 0) + share)
      grand += share
    }
  }
  if (grand > 0) for (const [k, v] of usage) usage.set(k, v / grand)
  usageCache.set(cacheKey, usage)
  return usage
}
