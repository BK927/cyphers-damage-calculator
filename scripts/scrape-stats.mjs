// 넥슨 공개 통계에서 입장/승률 순위 + 선호 아이템을 수집한다 (API 키 불필요).
//   node scripts/scrape-stats.mjs
// 출력: src/data/stats.json
// 엔드포인트(숫자 id 사용): /statistic/chart/{id}/{mode}, /statistic/rank/item/top/{id}/{mode}
import { readFileSync, writeFileSync } from 'node:fs'

const chars = JSON.parse(
  readFileSync(new URL('../src/data/characters.json', import.meta.url)),
).characters
const nameToSlug = new Map(chars.map((c) => [c.name, c.slug]))
const H = { headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0' } }
const MODE = 0
const MAX_ID = 90
const batch = 8
const rankDisp = (v) => (v == null || v === -1 ? null : v + 1) // 0-index → 표시 순위

async function jget(url) {
  try {
    const r = await fetch('https://cyphers.nexon.com' + url, H)
    const ct = r.headers.get('content-type') || ''
    if (!r.ok || !ct.includes('json')) return null
    return JSON.parse(await r.text())
  } catch {
    return null
  }
}

const ids = Array.from({ length: MAX_ID + 1 }, (_, i) => i) // 0-index 시작
const byId = {}

// 1) id → 캐릭터명 + 선호 아이템 (아이템 응답에 character 이름 포함)
for (let i = 0; i < ids.length; i += batch) {
  await Promise.all(
    ids.slice(i, i + batch).map(async (id) => {
      const items = await jget(`/statistic/rank/item/top/${id}/${MODE}`)
      if (Array.isArray(items) && items.length) {
        byId[id] = {
          name: items[0]?.itemInfo?.character,
          items: items.slice(0, 6).map((it) => ({
            name: it.itemName,
            parts: it.itemInfo?.equipPartsName,
            grade: it.grade,
            value: it.value,
          })),
        }
      }
    }),
  )
}

// 2) 매핑된 id의 순위
for (let i = 0; i < ids.length; i += batch) {
  await Promise.all(
    ids
      .slice(i, i + batch)
      .filter((id) => byId[id])
      .map(async (id) => {
        byId[id].rank = await jget(`/statistic/chart/${id}/${MODE}`)
      }),
  )
}

// 3) slug 기준으로 정리
const out = {}
const unmatched = []
for (const [id, v] of Object.entries(byId)) {
  const slug = nameToSlug.get(v.name)
  if (!slug) {
    if (v.name) unmatched.push(`${id}:${v.name}`)
    continue
  }
  out[slug] = {
    id: Number(id),
    entranceDaily: rankDisp(v.rank?.dailyEntranceRank),
    entranceWeekly: rankDisp(v.rank?.weeklyEntranceRank),
    winWeekly: rankDisp(v.rank?.weeklyWinRank),
    winMonthly: rankDisp(v.rank?.montlyWinRank),
    items: v.items,
  }
}

console.log('mapped:', Object.keys(out).length, '/ ids with data:', Object.keys(byId).length)
if (unmatched.length) console.log('UNMATCHED:', unmatched.join(', '))
const missing = chars.filter((c) => !out[c.slug]).map((c) => c.name)
if (missing.length) console.log('MISSING chars:', missing.join(', '))

writeFileSync(
  new URL('../src/data/stats.json', import.meta.url),
  JSON.stringify(
    {
      source: 'https://cyphers.nexon.com/statistic',
      mode: MODE,
      scrapedAt: new Date().toISOString().slice(0, 10),
      characters: out,
    },
    null,
    0,
  ),
)
