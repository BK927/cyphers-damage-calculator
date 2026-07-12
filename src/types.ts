// 사이퍼즈 데미지 계산기 — 도메인 타입
// 주의: 넥슨이 공식 데미지 수식을 공개하지 않아, 스킬 계수/공식은 커뮤니티 역산 추정치 기반이다.
// 기본 능력치(BaseStats)만 공식 출처(cyphers.nexon.com)에서 수집한 정확한 값이다.

export type StatKey = 'attack' | 'crit' | 'evade' | 'defense' | 'hp' | 'move'

/** 캐릭터 기본 능력치 — 공식 홈페이지 표기값 */
export interface BaseStats {
  attack: number // 공격
  crit: number // 치명
  hp: number // 체력
  evade: number // 회피
  defense: number // 방어 (표기값; 실제 근/원거리 방어력은 비공개라 %로 근사)
  move: number // 이동
}

export interface Character extends BaseStats {
  slug: string
  name: string
}

/** 스킬의 한 타(hit) — 공식 스킬 페이지 값 */
export interface SkillHit {
  label: string
  fixed: number // 고정 데미지
  percent: number // 퍼센트 계수 (× 공격력)
  down: number | null // 다운된 적 계수
}

export type SkillMode = '1st' | '2nd'

/** 스킬 (공식 스킬 페이지에서 수집) */
export interface Skill {
  name: string
  cooldown: number | null // 쿨타임(초) — 평타(<1)/궁(>=40) 판별용
  key: string // 조작키 (예: 마우스 좌클릭, F)
  grab: boolean // F키 전용 잡기 스킬 (일반 사이클에서 제외)
  modes: SkillMode[] // 이 스킬이 속한 궁극기 모드 (1st궁/2nd궁, 공용이면 둘 다)
  coeff: { 대인?: number; 공성?: number; 몬스터?: number } // 아머 계수(대상 종류)
  hits: SkillHit[]
}

/** 계산에 쓰이는 대표 스킬 계수 (캐릭터별 실제 값 + 전역 스킬공격력) */
export interface SkillProfile {
  fixed: number // 고정 데미지 (공식)
  percent: number // 퍼센트 계수 (공식)
  skillPower: number // 스킬공격력 배수 (아이템/레벨 — 편집 가능)
  armorCoeff: number // 대인 아머 계수 (공식)
  downCoeff: number // 다운된 적 계수 (공식, 대표 타 기준)
}

/** 공격킷이 능력치에 주는 버프 — 고정 가산(flat) 또는 기본값 대비 퍼센트(percent) */
export interface KitBuff {
  stat: StatKey
  flat?: number // +N
  percent?: number // 기본 스탯의 +N%
}

/** 공격킷: 능력치 버프 묶음 + 데미지 관련 옵션 */
export interface AttackKit {
  id: string
  name: string
  desc?: string
  buffs: KitBuff[]
  damageIncrease?: number // 장신구 데미지 증가율 (0.1 = +10%)
  penetration?: number // 방어관통 (0.5 = 상대 방어의 50%를 무시)
  defenseReduction?: number // 방어무시 디버프 (0.1 = 받는 피해 +10%)
}

/** 내 아이템(장비) 빌드 — 공격 측 스탯 가산. 대상을 때리는 데미지에 영향. */
export interface ItemBuild {
  enabled: boolean
  attack: number // 공격력 + (장갑 등, 고정 가산)
  crit: number // 치명 + (모자·공목 등, 고정 가산)
  critDamage: number // 치명 피해량 + (공목 등, 0.05 = +5% → 치명타 배율에 가산)
  penetration: number // 방어관통 + (이펙션류, 0.1 = 10%)
}

/** 공격 대상(피격자) 프로필 */
export interface TargetProfile {
  defense: number // 상대 방어 (% 표기값, 예: 15 → 15%)
  evade: number // 상대 회피 스탯
}

/** 상황 배수 */
export interface Situation {
  backAttack: boolean // 백어택 → 스킬공격력 +0.05
  down: boolean // 다운된 대상 → ×0.9
}
