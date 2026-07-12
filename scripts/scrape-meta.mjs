// 넥슨 공개 통계에서 캐릭터별 '메타 빌드'를 티어별로 수집한다 (API 키 불필요).
//   node scripts/scrape-meta.mjs   →  src/data/meta.json
// 엔드포인트:
//   /statistic/rank/entrance/{기간}/{티어}                  입장률 (rankList)
//   /statistic/rank/item/top/{id}/0                        슬롯별 top 아이템 (이름 매핑·장신구 fallback)
//   /statistic/rank/item/{id}/{기간}/{티어}/{SLOT}          슬롯별 착용 분포
// 기간: 1=일일, 2=주간(사용). 티어: 0=전체,1=에이스,2=조커,3=다이아,4=골드,5=실버,6=브론즈.
// 용량 최적화: 아이템 정의(레벨별 스탯)는 캐릭터당 사전(items)에 1회만, 티어별로는 (참조,pct)만 저장.
import { readFileSync, writeFileSync } from 'node:fs'

const chars = JSON.parse(
  readFileSync(new URL('../src/data/characters.json', import.meta.url)),
).characters
const nameToSlug = new Map(chars.map((c) => [c.name, c.slug]))
const H = { headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0' } }
const PERIOD = 2 // 주간
const TIERS = ['0', '1', '2', '3', '4', '5', '6']
const MAX_ID = 95
const GEAR_SLOT_CODES = {
  HAND: '손(공격)',
  HEAD: '머리(치명)',
  CHEST: '가슴(체력)',
  WAIST: '허리(회피)',
  LEG: '다리(방어)',
  FOOT: '발(이동)',
  NECK: '목',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function jget(url, tries = 4) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch('https://cyphers.nexon.com' + url, H)
      const ct = r.headers.get('content-type') || ''
      if (r.status === 429) {
        await sleep(600 * (t + 1))
        continue
      }
      if (r.ok && ct.includes('json')) return JSON.parse(await r.text())
    } catch {
      /* retry */
    }
    await sleep(250 * (t + 1))
  }
  return null
}
async function pool(items, fn, conc = 6) {
  let i = 0
  const out = []
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx], idx)
      }
    }),
  )
  return out
}

function parseEffect(effect) {
  const out = []
  for (const raw of (effect || '').split(/<br>|\n/)) {
    const m = raw.trim().match(/^(.+?)\s*:\s*([+-][\d.]+)\s*(%?)/)
    if (m) out.push({ key: m[1].trim(), value: parseFloat(m[2]) })
  }
  return out
}

function aggregate(items) {
  const b = {
    attack: 0, crit: 0, evade: 0, critDamage: 0, hp: 0,
    defenseParts: [], skillBoost: {},
  }
  for (const it of items) {
    for (const e of parseEffect(it.effect)) {
      const k = e.key
      if (k === '공격력') b.attack += e.value
      else if (k === '치명타') b.crit += e.value
      else if (k === '회피') b.evade += e.value
      else if (k === '치명타 피해량') b.critDamage += e.value
      else if (k === '체력') b.hp += e.value
      else if (k === '방어 관통력') b.penetration = (b.penetration || 0) + e.value / 100
      else if (k === '방어력') b.defenseParts.push(e.value / 100)
      else {
        const sm = k.match(/^(.+?)\([A-Za-z가-힣]+\)\s*(인간추가공격력|추가공격력)$/)
        if (sm) for (const name of sm[1].split('/')) b.skillBoost[name.trim()] = (b.skillBoost[name.trim()] || 0) + e.value
      }
    }
  }
  b.defenseReduction = 1 - b.defenseParts.reduce((acc, d) => acc * (1 - d), 1)
  delete b.defenseParts
  return b
}

function parseLevels(tooltipMore) {
  const text = (tooltipMore || '').replace(/<br>/g, '\n')
  const parts = text.split(/\[\d+\s*레벨\]/)
  const levels = []
  for (let i = 1; i < parts.length; i++) {
    const coinM = parts[i].match(/비용\s*([\d,]+)\s*coin/)
    levels.push({ coin: coinM ? Number(coinM[1].replace(/,/g, '')) : 0, ...aggregate([{ effect: parts[i] }]) })
  }
  return levels
}

// 아이템 정의 (티어 무관, 캐릭터당 1회)
const makeItemDef = (name, icon, effect, tooltipMore) => {
  let levels = parseLevels(tooltipMore)
  const total = aggregate([{ effect }])
  if (!levels.length) levels = [{ coin: 0, ...total }]
  return { name: (name || '').trim(), icon: icon || '', levels, total }
}
const kitEntry = (x, totalV) => {
  const stat = aggregate([{ effect: x.itemInfo?.equipEffect || '' }])
  delete stat.skillBoost
  return { name: (x.itemName || '').trim(), icon: x.iconName || x.itemInfo?.iconName || '', pct: +((x.value || 0) / totalV).toFixed(4), ...stat }
}

// ── 1) 티어별 입장률 ──
const pickByTier = {} // tier → slug → {value, rate}
{
  const namesByLen = [...chars].sort((a, b) => b.name.length - a.name.length)
  const matchSlug = (n) => namesByLen.find((c) => (n || '').endsWith(c.name))?.slug
  for (const t of TIERS) {
    const rows = (await jget(`/statistic/rank/entrance/${PERIOD}/${t}`))?.rankList || []
    const total = rows.reduce((s, r) => s + (r.value || 0), 0) || 1
    pickByTier[t] = {}
    for (const r of rows) {
      const slug = matchSlug(r.chNameKr)
      if (slug) pickByTier[t][slug] = { value: r.value, rate: r.value / total }
    }
    process.stderr.write(`  entrance tier ${t}: ${rows.length} chars, ${total} total\n`)
  }
}

// ── 2) id → 캐릭터 매핑 + top 아이템 (장신구 fallback 용) ──
const byId = {}
await pool(Array.from({ length: MAX_ID + 1 }, (_, i) => i), async (id) => {
  const items = await jget(`/statistic/rank/item/top/${id}/0`)
  if (Array.isArray(items) && items.length) {
    byId[id] = {
      name: items[0]?.itemInfo?.character,
      top: items.map((it) => ({
        slot: it.itemInfo?.equipPartsName,
        name: (it.itemName || '').trim(),
        icon: it.iconName || it.itemInfo?.iconName || '',
        effect: it.itemInfo?.equipEffect || '',
        tooltipMore: it.itemInfo?.tooltipMore || '',
      })),
    }
  }
})
process.stderr.write(`  ids mapped: ${Object.keys(byId).length}\n`)

// ── 3) 캐릭터×티어×슬롯 분포 ──
const mappedIds = Object.keys(byId).map(Number)
const jobs = []
for (const id of mappedIds) for (const t of TIERS) jobs.push({ id, t })
let done = 0
await pool(jobs, async ({ id, t }) => {
  const rec = (byId[id].tiers ??= {})
  const cur = (rec[t] = { gear: {}, atkKits: null, defKits: null })
  for (const [code, slotName] of Object.entries(GEAR_SLOT_CODES)) {
    const arr = await jget(`/statistic/rank/item/${id}/${PERIOD}/${t}/${code}`)
    if (Array.isArray(arr) && arr.length) cur.gear[slotName] = arr.slice(0, 4)
  }
  cur.atkKits = await jget(`/statistic/rank/item/${id}/${PERIOD}/${t}/ITEM_ATTACK`)
  cur.defKits = await jget(`/statistic/rank/item/${id}/${PERIOD}/${t}/ITEM_DEFENSE`)
  if (++done % 50 === 0) process.stderr.write(`  char-tier ${done}/${jobs.length}\n`)
}, 6)

// ── 4) 조립: 아이템 사전 + 티어별 참조 ──
const out = {}
for (const [id, v] of Object.entries(byId)) {
  const slug = nameToSlug.get(v.name)
  if (!slug) continue
  const items = {} // name → def
  const ensureItem = (name, icon, effect, tooltipMore) => {
    const key = (name || '').trim()
    if (key && !items[key]) items[key] = makeItemDef(name, icon, effect, tooltipMore)
    return key
  }
  // 장신구 등 top 전용 슬롯 (티어 분포 미지원 슬롯)
  const topOnlySlots = {}
  for (const r of v.top || []) {
    if (!r.slot || /킷$/.test(r.slot)) continue
    if (!Object.values(GEAR_SLOT_CODES).includes(r.slot)) {
      const key = ensureItem(r.name, r.icon, r.effect, r.tooltipMore)
      if (key) topOnlySlots[r.slot] = [{ k: key, pct: 1 }]
    }
  }
  const tiers = {}
  for (const t of TIERS) {
    const src = v.tiers?.[t]
    if (!src) continue
    const gearSlots = {}
    let samples = 0
    for (const [slotName, arr] of Object.entries(src.gear || {})) {
      const totalV = arr.reduce((s, x) => s + (x.value || 0), 0) || 1
      if (slotName === '손(공격)') samples = totalV
      gearSlots[slotName] = arr.map((x) => ({
        k: ensureItem(x.itemName, x.iconName || x.itemInfo?.iconName, x.itemInfo?.equipEffect || '', x.itemInfo?.tooltipMore || ''),
        pct: +((x.value || 0) / totalV).toFixed(4),
      }))
    }
    Object.assign(gearSlots, topOnlySlots)
    const mkKits = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return []
      const totalV = arr.reduce((s, x) => s + (x.value || 0), 0) || 1
      return arr.map((x) => kitEntry(x, totalV))
    }
    const atk = mkKits(src.atkKits)
    const def = mkKits(src.defKits)
    // 역할: 그 티어의 목걸이 1위가 방어옵션이면 탱커
    const neckKey = gearSlots['목']?.[0]?.k
    const neck = neckKey ? items[neckKey] : null
    const role = neck && neck.total.defenseReduction > 0 ? 'tank' : 'dealer'
    tiers[t] = {
      pickRate: pickByTier[t]?.[slug]?.rate ?? 0,
      samples,
      role,
      gearSlots,
      attackKits: atk,
      defenseKits: def,
    }
  }
  out[slug] = { id: Number(id), name: v.name, items, tiers }
}

console.log('mapped:', Object.keys(out).length, '/', chars.length)
const missing = chars.filter((c) => !out[c.slug]).map((c) => c.name)
if (missing.length) console.log('MISSING:', missing.join(', '))
// 표본 요약
const s0 = Object.values(out).map((c) => c.tiers['0']?.samples ?? 0)
const s1 = Object.values(out).map((c) => c.tiers['1']?.samples ?? 0)
console.log('전체 티어 표본(min/median):', Math.min(...s0), '/', s0.sort((a, b) => a - b)[Math.floor(s0.length / 2)])
console.log('에이스 표본(min/median):', Math.min(...s1), '/', s1.sort((a, b) => a - b)[Math.floor(s1.length / 2)])

writeFileSync(
  new URL('../src/data/meta.json', import.meta.url),
  JSON.stringify(
    {
      source: 'https://cyphers.nexon.com/statistic',
      period: 'weekly',
      tiers: { 0: '전체', 1: '에이스', 2: '조커', 3: '다이아', 4: '골드', 5: '실버', 6: '브론즈' },
      scrapedAt: new Date().toISOString().slice(0, 10),
      characters: out,
    },
    null,
    0,
  ),
)
