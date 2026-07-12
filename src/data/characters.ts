import type { Character } from '../types'
import raw from './characters.json'

/** 공식 홈페이지(cyphers.nexon.com)에서 수집한 84명 기본 능력치 */
export const characters: Character[] = raw.characters as Character[]
export const dataSource: string = raw.source
export const scrapedAt: string = raw.scrapedAt
