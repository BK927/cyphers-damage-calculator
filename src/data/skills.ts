import type { Skill } from '../types'
import raw from './skills.json'

/** 공식 스킬 페이지(cyphers.nexon.com/game/character/skill/{slug})에서 수집한 스킬 계수 */
export const skillsBySlug = raw.characters as Record<string, Skill[]>
export const skillsScrapedAt: string = raw.scrapedAt

const REF_ATTACK = 150 // 대표 타 선정용 기준 공격력

export interface RepSkill {
  skillName: string
  hitLabel: string
  fixed: number
  percent: number
  armorCoeff: number
  downCoeff: number
}

/** 캐릭터의 대표 스킬 = 기준 공격력에서 데미지가 가장 큰 단일 타 */
export function representativeHit(slug: string): RepSkill | null {
  const skills = skillsBySlug[slug]
  if (!skills?.length) return null
  let best: RepSkill | null = null
  let bestScore = -1
  for (const s of skills) {
    for (const h of s.hits) {
      const score = h.fixed + h.percent * REF_ATTACK
      if (score > bestScore) {
        bestScore = score
        best = {
          skillName: s.name,
          hitLabel: h.label,
          fixed: h.fixed,
          percent: h.percent,
          armorCoeff: s.coeff.대인 ?? 1,
          downCoeff: h.down ?? 1,
        }
      }
    }
  }
  return best
}
