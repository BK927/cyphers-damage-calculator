// 시뮬레이션 엔진 (장비 레벨 단위)
// - 장비 상태(GearState) = 슬롯별 {아이템 선택, 레벨}. 자동 세팅은 대세 빌드 순서로 생성.
// - 스킬별 기대 데미지 (평타/스킬/잡기/궁), 사이클·+잡기·+궁 합계
// - 상대: 역할 필드(입장률 가중, 같은 진행도) / 단일 상대(장비·킷 직접)
// - 우선 구매 특전: 손 3레벨→방어관통 +3%, 가슴 3레벨→체력 +5% (3번째 구매 시점부터)

import { critFactor } from './engine'
import { characters } from './data/characters'
import type { Character, Skill, SkillMode } from './types'
import { tierView, type GearItem, type KitOption, type Tier } from './data/meta'
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

/**
 * 상대용 기대 장비 스탯 — 부위마다 해당 티어 착용률로 후보 전체를 가중 평균.
 * 가산 스탯(공격·체력·회피 등)은 정확한 기대값, 부위 방어%는 선형 근사.
 */
function gearStatsExpected(slug: string, gear: GearState, tier: Tier): GearAcc {
  const slots = gearSlotsOf(slug, tier)
  const acc: GearAcc = {
    attack: 0, crit: 0, critDamage: 0, penetration: 0, evade: 0, hp: 0, hpMult: 1,
    skillBoost: {}, defenseParts: [],
  }
  for (const [slot, pick] of Object.entries(gear)) {
    const cands = slots[slot]
    if (!cands?.length) continue
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

export function attackerFrom(slug: string, gear: GearState, kit: KitOption | null, tier: Tier = '0'): Attacker {
  const base = charBySlug[slug]
  const g = gearStats(slug, gear, tier)
  return {
    attack: (base?.attack ?? 0) + g.attack + (kit?.attack ?? 0),
    crit: (base?.crit ?? 0) + g.crit + (kit?.crit ?? 0),
    critDamage: (g.critDamage + (kit?.critDamage ?? 0)) / 100,
    penetration: g.penetration + (kit?.penetration ?? 0),
    skillBoost: g.skillBoost,
  }
}

export function defenderFrom(slug: string, gear: GearState, kit: KitOption | null, tier: Tier = '0', expected = false): Defender {
  const base = charBySlug[slug]
  const g = (expected ? gearStatsExpected : gearStats)(slug, gear, tier)
  return {
    reduction: combineDefense([(base?.defense ?? 0) / 100, ...g.defenseParts, kit?.defenseReduction ?? 0]),
    evade: (base?.evade ?? 0) + g.evade + (kit?.evade ?? 0),
  }
}

export function hpFrom(slug: string, gear: GearState, kit: KitOption | null = null, tier: Tier = '0', expected = false): number {
  const base = charBySlug[slug]
  const g = (expected ? gearStatsExpected : gearStats)(slug, gear, tier)
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
 * 서브필드 타깃 — 입장률 가중, 각 상대도 같은 진행도의 자동 세팅.
 * 탱커는 방어킷 착용 분포로 가중을 나눔(방탱/회탱). 두 서브필드 합 = 원래 탱커 필드.
 */
/** 딜러용 기대 방어킷 — 착용 분포 전체를 가중 평균한 합성 킷 (방어%는 선형 근사) */
function expectedDefKit(kits: KitOption[]): KitOption | null {
  if (!kits.length) return null
  const totalPct = kits.reduce((s, k) => s + (k.pct ?? 0), 0) || 1
  const mix: KitOption = {
    name: '착용 분포 평균', pct: 1,
    attack: 0, crit: 0, critDamage: 0, evade: 0, hp: 0, defenseReduction: 0,
  }
  for (const k of kits) {
    const w = (k.pct ?? 0) / totalPct
    mix.evade += w * (k.evade ?? 0)
    mix.hp += w * (k.hp ?? 0)
    mix.defenseReduction += w * (k.defenseReduction ?? 0)
  }
  return mix
}

export function subFieldTarget(kind: FieldKind, stage: number, tier: Tier = '0', excludeSlug?: string): Target {
  const wantTank = kind !== 'dealer'
  const items: FieldItem[] = []
  for (const c of characters) {
    const m = tierView(c.slug, tier)
    if (c.slug === excludeSlug || (m.pickRate ?? 0) <= 0) continue
    if (wantTank ? m.role !== 'tank' : m.role !== 'dealer') continue
    const gear = autoGear(c.slug, stage, tier)
    if (!wantTank) {
      const kit = expectedDefKit(m.defenseKits ?? [])
      items.push({ w: m.pickRate, def: defenderFrom(c.slug, gear, kit, tier, true), hp: hpFrom(c.slug, gear, kit, tier, true), slug: c.slug, kitName: kit?.name })
      continue
    }
    const dks = m.defenseKits?.length ? m.defenseKits : []
    if (!dks.length) {
      if (kind === 'tankArmor') items.push({ w: m.pickRate, def: defenderFrom(c.slug, gear, null, tier, true), hp: hpFrom(c.slug, gear, null, tier, true), slug: c.slug })
      continue
    }
    const totalPct = dks.reduce((s, k) => s + (k.pct ?? 0), 0) || 1
    for (const kit of dks) {
      const evade = isEvadeKit(kit)
      if (kind === 'tankEvade' ? !evade : evade) continue
      const w = m.pickRate * ((kit.pct ?? 0) / totalPct)
      if (w > 0) items.push({ w, def: defenderFrom(c.slug, gear, kit, tier, true), hp: hpFrom(c.slug, gear, kit, tier, true), slug: c.slug, kitName: kit.name })
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

/** 스킬 1개(모든 타 합)의 기대 데미지 */
export function skillDamage(skill: Skill, atk: Attacker, def: Defender): number {
  const boost = (atk.skillBoost[skill.name] ?? 0) / 100
  const armor = skill.coeff.대인 ?? 1
  let raw = 0
  for (const h of skill.hits) raw += h.fixed + h.percent * atk.attack
  const base = raw * armor * (1 + boost)
  const afterDef = base * (1 - def.reduction * (1 - atk.penetration))
  const cf = critFactor(atk.crit, def.evade, atk.critDamage)
  return Math.max(0, afterDef * cf.factor)
}

function evalSkill(skill: Skill, atk: Attacker, t: Target): number {
  if (t.kind === 'single') return skillDamage(skill, atk, t.def)
  let s = 0
  for (const it of t.items) s += it.w * skillDamage(skill, atk, it.def)
  return s / t.totalW
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
  damage: number
}
export interface SimResult {
  skills: SkillDamage[]
  cycle: number // 평타+스킬 합 (잡기·궁 제외)
  grab: number // 잡기 합
  ult: number // 최대 궁
  cyclePlusGrab: number
  cyclePlusUlt: number
  hp: number
}

export function simulate(slug: string, atk: Attacker, t: Target, mode: SkillMode = '1st'): SimResult {
  const skills = getSkills(slug, mode).map(({ skill, cls }) => ({
    skill,
    cls,
    damage: evalSkill(skill, atk, t),
  }))
  const cycle = skills
    .filter((s) => s.cls === 'basic' || s.cls === 'skill')
    .reduce((a, s) => a + s.damage, 0)
  const grab = skills.filter((s) => s.cls === 'grab').reduce((a, s) => a + s.damage, 0)
  const ult = skills.filter((s) => s.cls === 'ult').reduce((a, s) => Math.max(a, s.damage), 0)
  return { skills, cycle, grab, ult, cyclePlusGrab: cycle + grab, cyclePlusUlt: cycle + ult, hp: targetHP(t) }
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
