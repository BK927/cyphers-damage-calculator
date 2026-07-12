import raw from './buildorder.json'

export interface BuildSlot {
  slot: string // 슬롯명 (예: 손(공격))
  level: number // 그 슬롯의 몇 번째 레벨 구매인지 (1,2,3…)
  avgStep: number // 평균 구매 순번
  freq: number // 표본 중 이 (슬롯,레벨)을 산 비율
}
export interface CharBuild {
  samples: number
  order: BuildSlot[] // 평균 구매 순번 오름차순
}

/** Neople API itemPurchase 집계로 추론한 캐릭터별 대세 빌드 순서 */
export const buildBySlug = raw.characters as unknown as Record<string, CharBuild>
export const buildScrapedAt: string = raw.scrapedAt
