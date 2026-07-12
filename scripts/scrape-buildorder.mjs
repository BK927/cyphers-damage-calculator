// Neople 공식 API로 캐릭터별 '대세 빌드 순서'를 추론한다.
//   node --env-file=.env scripts/scrape-buildorder.mjs   →  src/data/buildorder.json
// 방식: 랭커 N명 → 각자 최근 매치 → 매치 상세의 itemPurchase(산 순서대로 itemId)를
//       슬롯 순서로 환원 → 캐릭터별 슬롯 평균 구매 순번으로 정렬.
// ⚠️ API 키 필요(NEOPLE_API_KEY, 서버사이드 전용). 레이트리밋 대비 재시도+동시성 제한.
import { readFileSync, writeFileSync } from 'node:fs'

const KEY = process.env.NEOPLE_API_KEY
if (!KEY) {
  console.error('NEOPLE_API_KEY 없음 (node --env-file=.env 로 실행)')
  process.exit(1)
}
const BASE = 'https://api.neople.co.kr/cy'
const PLAYERS = Number(process.env.PLAYERS || 300)
const MATCHES_PER_PLAYER = Number(process.env.MPP || 8)
const MATCH_CAP = Number(process.env.MATCH_CAP || 2500)
const CONC = 6

const chars = JSON.parse(
  readFileSync(new URL('../src/data/characters.json', import.meta.url)),
).characters
const nameToSlug = new Map(chars.map((c) => [c.name, c.slug]))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function jget(path, tries = 4) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}apikey=${KEY}`
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url)
      if (r.status === 429) {
        await sleep(500 * (t + 1))
        continue
      }
      if (r.ok) return await r.json()
    } catch {
      /* retry */
    }
    await sleep(200 * (t + 1))
  }
  return null
}

async function pool(items, fn, conc = CONC) {
  const out = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  return out
}

// 1) 랭커 playerId 수집
const players = []
for (let off = 0; players.length < PLAYERS && off < 2000; off += 100) {
  const j = await jget(`/ranking/ratingpoint?offset=${off}&limit=100`)
  const rows = j?.rows || []
  if (!rows.length) break
  for (const r of rows) players.push(r.playerId)
}
players.length = Math.min(players.length, PLAYERS)
console.log('rankers:', players.length)

// 2) 매치 id 수집 (dedupe)
const matchIds = new Set()
await pool(players, async (pid) => {
  const j = await jget(`/players/${pid}/matches?gameTypeId=rating&limit=${MATCHES_PER_PLAYER}`)
  for (const m of j?.matches?.rows || []) matchIds.add(m.matchId)
})
let ids = [...matchIds]
if (ids.length > MATCH_CAP) ids = ids.slice(0, MATCH_CAP)
console.log('unique matches:', ids.length)

// 3) 매치 상세 → (캐릭터, 슬롯 구매 순서) 집계
// agg[slug][slotName] = { steps: [평균낼 순번들] }
const agg = {}
const record = (slug, seq) => {
  agg[slug] ??= { samples: 0, keys: {} }
  agg[slug].samples++
  seq.forEach((item, step) => {
    const key = item.slot + '#' + item.level
    const s = (agg[slug].keys[key] ??= { slot: item.slot, level: item.level, stepSum: 0, count: 0 })
    s.stepSum += step
    s.count++
  })
}

let done = 0
await pool(ids, async (mid) => {
  const md = await jget(`/matches/${mid}`)
  for (const p of md?.players || []) {
    const slug = nameToSlug.get(p.playInfo?.characterName)
    if (!slug || !Array.isArray(p.itemPurchase)) continue
    const slotOf = {}
    for (const it of p.items || []) slotOf[it.itemId] = it.slotName
    const lvl = {}
    const seq = []
    for (const id of p.itemPurchase) {
      const slot = slotOf[id]
      if (!slot || /킷/.test(slot)) continue // 킷(소모품)은 재구매라 제외
      lvl[slot] = (lvl[slot] || 0) + 1
      seq.push({ slot, level: lvl[slot] }) // 슬롯 + 몇 번째 레벨 구매
    }
    if (seq.length) record(slug, seq)
  }
  if (++done % 200 === 0) process.stderr.write(`  matches ${done}/${ids.length}\n`)
})

// 4) (슬롯,레벨) 평균 구매 순번으로 정렬
const out = {}
for (const [slug, v] of Object.entries(agg)) {
  const order = Object.values(v.keys)
    .map((s) => ({ slot: s.slot, level: s.level, avgStep: +(s.stepSum / s.count).toFixed(2), freq: +(s.count / v.samples).toFixed(2) }))
    .filter((o) => o.freq >= 0.25) // 표본의 25%+ 가 산 것만
    .sort((a, b) => a.avgStep - b.avgStep)
  out[slug] = { samples: v.samples, order }
}

const covered = Object.values(out).filter((o) => o.samples >= 10).length
console.log('characters with data:', Object.keys(out).length, '| samples>=10:', covered)
console.log('deimus:', JSON.stringify(out.deimus))

writeFileSync(
  new URL('../src/data/buildorder.json', import.meta.url),
  JSON.stringify(
    { source: 'neople api itemPurchase', scrapedAt: new Date().toISOString().slice(0, 10), characters: out },
    null,
    0,
  ),
)
