import raw from './stats.json'

export interface PreferItem {
  name: string
  parts: string
  grade: string
  value: number
}

export interface CharStat {
  id: number
  entranceDaily: number | null
  entranceWeekly: number | null
  winWeekly: number | null
  winMonthly: number | null
  items: PreferItem[]
}

/** 넥슨 공개 통계: 입장/승률 순위 + 선호 아이템 (키 불필요로 수집) */
export const statsBySlug = raw.characters as Record<string, CharStat>
export const statsScrapedAt: string = raw.scrapedAt
