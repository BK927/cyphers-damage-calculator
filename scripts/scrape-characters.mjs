// 넥슨 공식 캐릭터 정보 페이지에서 기본 능력치 6종을 수집해 characters.json을 갱신한다.
//   node scripts/scrape-characters.mjs
// 밸런스 패치로 바뀔 수 있는 공격/치명/체력/회피/방어/이동을 재수집.
// 로스터(slug/name)는 기존 characters.json 기준으로 순회 — 신규 캐릭터는 자동 추가되지 않음(별도 갱신 필요).
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'node-html-parser'

const prev = JSON.parse(
  readFileSync(new URL('../src/data/characters.json', import.meta.url)),
)
const chars = prev.characters
const UA = { 'User-Agent': 'Mozilla/5.0' }
// 페이지 라벨 → characters.json 필드
const LABEL = { 공격: 'attack', 치명: 'crit', 체력: 'hp', 회피: 'evade', 방어: 'defense', 이동: 'move' }

// info 페이지의 능력치 블록: <div class="s1_21"><p>공격<em>115</em></p>...</div>
function parseStats(html) {
  const box = parse(html).querySelector('div.s1_21')
  if (!box) return null
  const stat = {}
  for (const p of box.querySelectorAll('p')) {
    const em = p.querySelector('em')
    if (!em) continue
    const key = LABEL[p.text.replace(em.text, '').trim()]
    if (key) stat[key] = parseFloat(em.text.trim())
  }
  return Object.keys(stat).length === 6 ? stat : null // 6종 다 파싱돼야 유효
}

const batch = 8
let updated = 0
const failed = []
for (let i = 0; i < chars.length; i += batch) {
  await Promise.all(
    chars.slice(i, i + batch).map(async (c) => {
      try {
        const r = await fetch(`https://cyphers.nexon.com/game/character/info/${c.slug}`, { headers: UA })
        const s = parseStats(await r.text())
        if (s) {
          Object.assign(c, s) // 기존 {slug,name} 유지, 스탯만 갱신 (필드 순서 보존)
          updated++
        } else failed.push(c.slug)
      } catch {
        failed.push(c.slug)
      }
    }),
  )
  process.stderr.write(`  ${Math.min(i + batch, chars.length)}/${chars.length}\n`)
}

// 기존 파일 포맷(캐릭터 1줄) 유지 — diff 최소화
const line = (c) =>
  `    { "slug": ${JSON.stringify(c.slug)}, "name": ${JSON.stringify(c.name)}, ` +
  `"attack": ${c.attack}, "crit": ${c.crit}, "hp": ${c.hp}, "evade": ${c.evade}, ` +
  `"defense": ${c.defense}, "move": ${c.move} }`
const json =
  '{\n' +
  `  "source": ${JSON.stringify(prev.source)},\n` +
  `  "scrapedAt": ${JSON.stringify(new Date().toISOString().slice(0, 10))},\n` +
  `  "note": ${JSON.stringify(prev.note)},\n` +
  '  "characters": [\n' +
  chars.map(line).join(',\n') +
  '\n  ]\n}\n'
writeFileSync(new URL('../src/data/characters.json', import.meta.url), json)

console.log('done. updated:', updated, '/', chars.length, '| failed:', failed.join(',') || 'none')
