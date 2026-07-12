// 넥슨 공식 스킬 페이지에서 전 캐릭터 스킬 계수를 수집한다.
//   node scripts/scrape-skills.mjs
// 출력: src/data/skills.json  (재실행하면 갱신)
// 각 스킬: 이름 + 대인/공성/몬스터 계수 + 타(hit)별 {고정댐, 퍼센트계수, 다운계수}
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'node-html-parser'

const chars = JSON.parse(
  readFileSync(new URL('../src/data/characters.json', import.meta.url)),
).characters
const UA = { 'User-Agent': 'Mozilla/5.0' }

function parseSkills(html) {
  const root = parse(html)
  // 1st궁 / 2nd궁 모드별 스킬 집합 (skill_lst 표: td0=1st, td2=2nd)
  const mode1 = new Set()
  const mode2 = new Set()
  const table = root.querySelector('table.skill_lst')
  if (table) {
    for (const tr of table.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td')
      const a1 = tds[0]?.querySelector('a')?.text?.trim()
      const a2 = tds[2]?.querySelector('a')?.text?.trim()
      if (a1) mode1.add(a1)
      if (a2) mode2.add(a2)
    }
  }
  const skills = []
  for (const box of root.querySelectorAll('div.skill_box')) {
    const name = (box.querySelector('h2')?.text || '').trim()
    if (!name || name === '스킬 목록') continue
    const coeff = {}
    const hits = []
    let cooldown = null
    for (const p of box.querySelectorAll('p')) {
      const b = (p.querySelector('b')?.text || '').trim()
      const iv = (p.querySelector('i')?.text || '').trim()
      if (b === '대인' || b === '공성' || b === '몬스터') coeff[b] = parseFloat(iv)
      if (b.startsWith('쿨타임')) cooldown = parseFloat(iv)
      const m = iv.match(/^([\d.]+)\s*\+\s*([\d.]+)\s*[x×]\s*공격력(?:\(다운된 적\s*([\d.]+)\))?/)
      if (m) hits.push({ label: b, fixed: +m[1], percent: +m[2], down: m[3] ? +m[3] : null })
    }
    // 잡기 = F키 전용 잡기 스킬 (조작키로 판별). 잡기 판정(grab judgment)과 무관.
    const key = (box.querySelector('.key')?.text || '').trim()
    const grab = key === 'F'
    if (hits.length) {
      const modes = []
      if (mode1.has(name)) modes.push('1st')
      if (mode2.has(name)) modes.push('2nd')
      skills.push({ name, cooldown, key, grab, coeff, hits, modes: modes.length ? modes : ['1st', '2nd'] })
    }
  }
  return skills
}

const out = {}
const batch = 8
for (let i = 0; i < chars.length; i += batch) {
  const chunk = chars.slice(i, i + batch)
  await Promise.all(
    chunk.map(async (c) => {
      try {
        const r = await fetch(`https://cyphers.nexon.com/game/character/skill/${c.slug}`, {
          headers: UA,
        })
        out[c.slug] = parseSkills(await r.text())
      } catch (e) {
        out[c.slug] = { error: String(e) }
      }
    }),
  )
  process.stderr.write(`  ${Math.min(i + batch, chars.length)}/${chars.length}\n`)
}

const empty = Object.entries(out)
  .filter(([, v]) => !Array.isArray(v) || v.length === 0)
  .map(([k]) => k)

const result = {
  source: 'https://cyphers.nexon.com/game/character/skill/{slug}',
  scrapedAt: new Date().toISOString().slice(0, 10),
  characters: out,
}
writeFileSync(
  new URL('../src/data/skills.json', import.meta.url),
  JSON.stringify(result, null, 0),
)
console.log('done. chars:', Object.keys(out).length, '| empty:', empty.join(',') || 'none')
