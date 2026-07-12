// 데미지 계산 엔진 (순수 함수)
// 커뮤니티 역산 공식 기반. 근거:
//  - 넥슨 공식 팁 "딜 계산하는 법": (고정댐 + 퍼센트계수×공격력) × 스킬공격력 × (1−방어) × 상황배수, 최종 내림
//  - 나무위키/캐릭터 밸런싱: 치명타 ×1.3, 회피 ×0.4(부분감산), 치명↔회피 단리 차감
//  - 방어관통: 상대 방어 × (1−관통%) 곱연산 / 방어무시 디버프: 받는 피해 ×(1+n%) 곱연산

import type {
  AttackKit,
  BaseStats,
  ItemBuild,
  Situation,
  SkillProfile,
  TargetProfile,
} from './types'

const CRIT_MULTIPLIER = 1.3 // 치명타 성공 시
const EVADE_MULTIPLIER = 0.4 // 회피 성공 시(60% 감소, 40% 잔존)
const BACKATTACK_SKILLPOWER = 0.05 // 백어택 시 스킬공격력 가산

/** 공격킷 버프를 기본 능력치에 적용한 유효 능력치 */
export function applyKit(base: BaseStats, kit: AttackKit | null): BaseStats {
  const out: BaseStats = { ...base }
  if (!kit) return out
  for (const b of kit.buffs) {
    const add = (b.flat ?? 0) + ((b.percent ?? 0) / 100) * base[b.stat]
    out[b.stat] = base[b.stat] + add
  }
  return out
}

export interface CritResult {
  factor: number // 기대 배수 (확률 가중)
  pCrit: number // 치명타 확률 (0~1)
  pEvade: number // 회피 확률 (0~1)
}

/**
 * 치명 스탯 ↔ 상대 회피 스탯의 단리 대결로 기대 배수를 구한다.
 * diff = 치명 − 회피.  양수면 그만큼(%) 치명타, 음수면 그만큼(%) 회피.
 * critDamage(치명 피해량)는 치명타 배율(1.3)에 가산된다.
 */
export function critFactor(
  critStat: number,
  targetEvade: number,
  critDamage = 0,
): CritResult {
  const critMult = CRIT_MULTIPLIER + critDamage
  const diff = critStat - targetEvade
  if (diff >= 0) {
    const pCrit = Math.min(diff, 100) / 100
    return { factor: (1 - pCrit) + pCrit * critMult, pCrit, pEvade: 0 }
  }
  const pEvade = Math.min(-diff, 100) / 100
  return { factor: (1 - pEvade) + pEvade * EVADE_MULTIPLIER, pCrit: 0, pEvade }
}

export interface DamageBreakdown {
  effAttack: number
  effCrit: number
  baseDamage: number // 고정 + 퍼센트×공격
  afterSkillPower: number
  afterDamageInc: number
  effectiveDefense: number // 관통 반영된 상대 실효 방어(0~1)
  afterDefense: number
  crit: CritResult
  expected: number // 최종 기대값 (내림)
}

export function calcDamage(
  base: BaseStats,
  skill: SkillProfile,
  kit: AttackKit | null,
  item: ItemBuild | null,
  target: TargetProfile,
  situation: Situation,
): DamageBreakdown {
  const kitted = applyKit(base, kit)
  const useItem = item?.enabled ? item : null
  const effAttack = kitted.attack + (useItem?.attack ?? 0)
  const effCrit = kitted.crit + (useItem?.crit ?? 0)

  const skillPower = skill.skillPower + (situation.backAttack ? BACKATTACK_SKILLPOWER : 0)
  const baseDamage = (skill.fixed + skill.percent * effAttack) * skill.armorCoeff
  const afterSkillPower = baseDamage * skillPower
  const afterDamageInc = afterSkillPower * (1 + (kit?.damageIncrease ?? 0))

  const penetration = (kit?.penetration ?? 0) + (useItem?.penetration ?? 0)
  const effectiveDefense = (target.defense / 100) * (1 - penetration)
  const afterDefense =
    afterDamageInc * (1 - effectiveDefense) * (1 + (kit?.defenseReduction ?? 0))

  const crit = critFactor(effCrit, target.evade, useItem?.critDamage ?? 0)
  const downMul = situation.down ? skill.downCoeff : 1
  const expected = Math.floor(afterDefense * crit.factor * downMul)

  return {
    effAttack,
    effCrit,
    baseDamage,
    afterSkillPower,
    afterDamageInc,
    effectiveDefense,
    afterDefense,
    crit,
    expected: Math.max(0, expected),
  }
}
