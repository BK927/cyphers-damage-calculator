import { useMemo, useState } from 'react'
import './App.css'
import { characters } from './data/characters'
import { iconNum } from './data/icons'
import { buildBySlug } from './data/buildorder'
import {
  attackKitOptions,
  kitSig,
  metaScrapedAt,
  TIER_LABELS,
  TIERS,
  tierView,
  type KitOption,
  type Tier,
} from './data/meta'
import {
  GEAR_SLOT_ORDER,
  attackerFrom,
  autoGear,
  fullGear,
  gearSlotsOf,
  hasTwoModes,
  maxStageOf,
  mergeFields,
  rankKits,
  simulate,
  singleTarget,
  subFieldTarget,
  type GearState,
  type SimResult,
  type SkillClass,
  type Target,
} from './recommend'
import type { SkillMode } from './types'

const iconUrl = (slug: string) =>
  `https://resource.cyphers.co.kr/ui/img/character/ico_23px_${iconNum[slug] ?? 0}.jpg`
const itemIcon = (icon?: string) =>
  icon ? `https://resource.cyphers.co.kr/ui/img/item_box/icon_thum/${icon}.png` : ''
const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) =>
  (e.currentTarget.style.visibility = 'hidden')

const NONE_KIT: KitOption = {
  name: '킷 없음', pct: 0, attack: 0, crit: 0, critDamage: 0, evade: 0, hp: 0, penetration: 0, defenseReduction: 0,
}
// 스탯이 완전히 열등한(dominated) 공격킷 제외
function dominated(k: KitOption): boolean {
  return attackKitOptions.some(
    (o) =>
      o !== k &&
      o.attack >= k.attack && o.crit >= k.crit && o.critDamage >= k.critDamage && (o.penetration ?? 0) >= (k.penetration ?? 0) &&
      (o.attack > k.attack || o.crit > k.crit || o.critDamage > k.critDamage || (o.penetration ?? 0) > (k.penetration ?? 0)),
  )
}
const atkOptions: KitOption[] = [NONE_KIT, ...attackKitOptions.filter((k) => !dominated(k))]

const CLS_LABEL: Record<SkillClass, string> = { basic: '평타', skill: '스킬', grab: '잡기', ult: '궁' }
const SLOT_SHORT: Record<string, string> = {
  '손(공격)': '손', '머리(치명)': '머리', '가슴(체력)': '가슴', '허리(회피)': '허리',
  '다리(방어)': '다리', '발(이동)': '발', 목: '목',
  장신구1: '장신1', 장신구2: '장신2', 장신구3: '장신3', 장신구4: '장신4',
}
const fmt = (n: number) => Math.round(n).toLocaleString()

function kitName(k: KitOption): string {
  if (k.name === '킷 없음') return '킷 없음'
  const atk = k.attack > 0, crit = k.crit > 0, pen = (k.penetration ?? 0) > 0
  if (atk && crit) return '넬스 크리민'
  if (atk && pen) return '파이크 이펙션'
  if (crit && pen) return '이펙트 이펙션'
  if (atk) return '파이크'
  if (crit) return '이펙트'
  return k.name
}
function kitStat(k: KitOption): string {
  const p: string[] = []
  if (k.attack) p.push(`공격 +${k.attack}`)
  if (k.crit) p.push(`치명 +${k.crit}`)
  if (k.critDamage) p.push(`치명피해 +${k.critDamage}%`)
  if (k.penetration) p.push(`관통 +${Math.round(k.penetration * 100)}%`)
  if (k.defenseReduction) p.push(`방어 +${+(k.defenseReduction * 100).toFixed(1)}%`)
  if (k.evade) p.push(`회피 +${k.evade}`)
  if (k.hp) p.push(`체력 +${k.hp}`)
  return p.join(' · ') || '미착용'
}
function formula(hits: { fixed: number; percent: number }[]): string {
  const f = hits.reduce((a, h) => a + h.fixed, 0)
  const p = hits.reduce((a, h) => a + h.percent, 0)
  return `${Math.round(f)}+${Math.round(p * 100) / 100}×공격`
}
const gearLevelCount = (g: GearState) => Object.values(g).reduce((s, p) => s + p.level, 0)

/* ---------- 장비 패널 (수동 편집) ---------- */
function GearPanel({
  slug, tier, gear, onChange, title, action,
}: {
  slug: string
  tier: Tier
  gear: GearState
  onChange: (g: GearState) => void
  title: string
  action?: { label: string; onClick: () => void }
}) {
  const slots = gearSlotsOf(slug, tier)
  return (
    <div className="gear-panel">
      <div className="gp-head">
        <span>{title}</span>
        {action && <button onClick={action.onClick}>{action.label}</button>}
      </div>
      {GEAR_SLOT_ORDER.filter((s) => slots[s]?.length).map((slot) => {
        const cands = slots[slot]
        const pick = gear[slot] ?? { item: 0, level: 0 }
        const cand = cands[pick.item] ?? cands[0]
        const max = cand.levels.length
        const setLevel = (lv: number) =>
          onChange({ ...gear, [slot]: { ...pick, level: Math.max(0, Math.min(max, lv)) } })
        return (
          <div key={slot} className="gp-row">
            <span className="gp-slot">{SLOT_SHORT[slot] ?? slot}</span>
            {cand.icon && (
              <img
                className={pick.level > 0 ? 'gp-icon' : 'gp-icon off'}
                src={itemIcon(cand.icon)}
                alt=""
                loading="lazy"
                onError={hideOnError}
              />
            )}
            {cands.length > 1 ? (
              <select
                className="gp-item"
                value={pick.item}
                onChange={(e) => onChange({ ...gear, [slot]: { item: +e.target.value, level: Math.min(pick.level || 0, cands[+e.target.value].levels.length) } })}
              >
                {cands.map((c, i) => (
                  <option key={i} value={i}>
                    {c.name} ({Math.round(c.pct * 100)}%)
                  </option>
                ))}
              </select>
            ) : (
              <span className="gp-item fixed" title={cand.name}>{cand.name}</span>
            )}
            <span className="gp-step">
              <button onClick={() => setLevel(pick.level - 1)} disabled={pick.level <= 0}>−</button>
              <b className={pick.level > 0 ? 'lv on' : 'lv'}>{pick.level}/{max}</b>
              <button onClick={() => setLevel(pick.level + 1)} disabled={pick.level >= max}>＋</button>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- 결과 패널 (표) ---------- */
type Tone = 'dealer' | 'armor' | 'evade' | 'single' | 'tank' | 'overall'
function ResultPanel({
  title, sub, tone, sim, noKit,
}: {
  title: string
  sub: string
  tone: Tone
  sim: SimResult
  noKit: SimResult
}) {
  const pctHp = (d: number) => `${Math.round((d / sim.hp) * 100)}`
  const kills = (sim.hp / sim.cyclePlusUlt).toFixed(2)
  const gain = Math.round((sim.cyclePlusUlt / (noKit.cyclePlusUlt || 1) - 1) * 100)
  return (
    <div className={`rp ${tone}`}>
      <div className="rp-head">
        <span className="rp-title">{title} <em>{sub}</em></span>
        <span className="rp-big">
          <b>{fmt(sim.cyclePlusUlt)}</b>
          <span className="rp-kill">{kills}컷</span>
        </span>
      </div>
      <table>
        <thead>
          <tr><th className="l">스킬</th><th>공식</th><th>데미지</th><th>HP%</th></tr>
        </thead>
        <tbody>
          {sim.skills.map(({ skill, cls, damage }) => (
            <tr key={skill.name} className={cls}>
              <td className="l">
                <i>{CLS_LABEL[cls]}</i>
                {skill.name}
              </td>
              <td className="f">{formula(skill.hits)}</td>
              <td className="d">{fmt(damage)}</td>
              <td className="h">{pctHp(damage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rp-sub">
        <span>사이클 <b>{fmt(sim.cycle)}</b></span>
        {sim.grab > 0 && <span>＋잡기 <b>{fmt(sim.cyclePlusGrab)}</b></span>}
        <span className="ke">킷 효과 <b className={gain >= 0 ? 'up' : 'down'}>{gain >= 0 ? '+' : ''}{gain}%</b></span>
      </div>
    </div>
  )
}

/* ---------- 앱 ---------- */
export default function App() {
  const [slug, setSlug] = useState('deimus')
  const [q, setQ] = useState('')
  const [favs, setFavs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('cyphers-favs') || '[]') } catch { return [] }
  })
  const [skillMode, setSkillMode] = useState<SkillMode>('1st')
  const [setting, setSetting] = useState<'auto' | 'manual'>('auto')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tier, setTier] = useState<Tier>('0')
  const [stage, setStage] = useState<number | null>(null) // null = max
  const [myGear, setMyGear] = useState<GearState | null>(null)
  const [selKitSig, setSelKitSig] = useState<string | null>(null)
  const [oppType, setOppType] = useState<'field' | 'single'>('field')
  const [kitSort, setKitSort] = useState<string>('all') // all=종합, dealer, armor, evade, tank(방탱+회탱)
  const [oppSlug, setOppSlug] = useState('jekiel')
  const [oppGear, setOppGear] = useState<GearState | null>(null)
  const [oppKitIdx, setOppKitIdx] = useState(0)

  const maxStage = maxStageOf(slug, tier)
  const stageEff = Math.min(stage ?? maxStage, maxStage)
  const twoModes = hasTwoModes(slug)

  const selectChar = (s: string) => {
    setSlug(s); setStage(null); setMyGear(null); setSelKitSig(null); setSkillMode('1st'); setQ(''); setPickerOpen(false)
  }
  const selectTier = (t: Tier) => {
    setTier(t); setMyGear(null); setOppGear(null); setSelKitSig(null); setOppKitIdx(0)
  }
  const toggleFav = (s: string) =>
    setFavs((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
      localStorage.setItem('cyphers-favs', JSON.stringify(next))
      return next
    })

  // 내 장비 (자동=대세 진행 / 수동=직접)
  const gearEff = useMemo(
    () => (setting === 'auto' ? autoGear(slug, stageEff, tier) : myGear ?? fullGear(slug, tier)),
    [setting, slug, stageEff, myGear, tier],
  )

  // 상대 타깃
  const oppKits = useMemo(() => {
    const list = tierView(oppSlug, tier).defenseKits
    return [...list, NONE_KIT]
  }, [oppSlug, tier])
  const targets: Target[] = useMemo(() => {
    if (setting === 'manual' && oppType === 'single') {
      const og = oppGear ?? fullGear(oppSlug, tier)
      return [singleTarget(oppSlug, og, oppKits[Math.min(oppKitIdx, oppKits.length - 1)] ?? null, tier)]
    }
    // 필드: 자동=슬라이더 진행도, 수동=내 구매 수에 맞춘 템포. 딜러 / 방탱 / 회탱
    const st = setting === 'auto' ? stageEff : gearLevelCount(gearEff)
    return [
      subFieldTarget('dealer', st, tier, slug),
      subFieldTarget('tankArmor', st, tier, slug),
      subFieldTarget('tankEvade', st, tier, slug),
    ]
  }, [setting, oppType, oppSlug, oppGear, oppKitIdx, oppKits, stageEff, gearEff, slug, tier])
  const fieldMode = targets.length === 3
  const TONES = ['dealer', 'armor', 'evade'] as const

  // 킷 랭킹 + 선택
  const kitRank = useMemo(
    () => rankKits(slug, gearEff, atkOptions, targets, skillMode, tier),
    [slug, gearEff, targets, skillMode, tier],
  )
  const bestSig = kitRank[0] ? kitSig(kitRank[0].kit) : null
  // 타깃별(딜러/탱커) 최고 킷 시그니처 — 서로 다를 수 있음(핵심 인사이트)
  const bestPerTarget = useMemo(
    () =>
      targets.map((_, i) => {
        let best = kitRank[0]
        for (const s of kitRank) if (s.per[i] > (best?.per[i] ?? 0)) best = s
        return best ? kitSig(best.kit) : null
      }),
    [kitRank, targets],
  )
  const selectedKit =
    (selKitSig ? atkOptions.find((k) => kitSig(k) === selKitSig) : null) ?? kitRank[0]?.kit ?? NONE_KIT
  // 정렬 기준: all=종합, dealer, tank(방탱+회탱), armor(방탱), evade(회탱)
  const sortKey = fieldMode ? kitSort : 'all'
  const kitScore = (per: number[], key: string) => {
    if (key === 'dealer') return per[0] ?? 0
    if (key === 'armor') return per[1] ?? 0
    if (key === 'evade') return per[2] ?? 0
    if (key === 'tank') return (per[1] ?? 0) + (per[2] ?? 0)
    return per.reduce((a, b) => a + b, 0) // all
  }
  const sortedKits = useMemo(() => {
    if (sortKey === 'all') return kitRank
    return [...kitRank].sort((a, b) => kitScore(b.per, sortKey) - kitScore(a.per, sortKey))
  }, [kitRank, sortKey])

  // 결과 패널 구성: 필드 모드=종합/딜러/탱커/방탱/회탱, 단일=1:1
  const panels = useMemo(() => {
    if (!fieldMode) {
      const name = characters.find((c) => c.slug === oppSlug)?.name ?? ''
      return [{ target: targets[0], tone: 'single' as Tone, title: `vs ${name}`, sub: '1:1 직접 세팅' }]
    }
    const [d, a, e] = targets
    return [
      { target: mergeFields(d, a, e), tone: 'overall' as Tone, title: '종합', sub: '실전 평균 전체' },
      { target: d, tone: 'dealer' as Tone, title: 'vs 딜러', sub: '공격형 목걸이 상대' },
      { target: mergeFields(a, e), tone: 'tank' as Tone, title: 'vs 탱커', sub: '방탱+회탱 종합' },
      { target: a, tone: 'armor' as Tone, title: 'vs 방탱', sub: '방어킷 착용 탱커' },
      { target: e, tone: 'evade' as Tone, title: 'vs 회탱', sub: '회피킷 착용 탱커' },
    ]
  }, [fieldMode, targets, oppSlug])

  // 시뮬 (킷 착용 / 미착용)
  const sims = useMemo(() => {
    const atk = attackerFrom(slug, gearEff, selectedKit, tier)
    const none = attackerFrom(slug, gearEff, NONE_KIT, tier)
    return panels.map((p) => ({ ...p, sim: simulate(slug, atk, p.target, skillMode), noKit: simulate(slug, none, p.target, skillMode) }))
  }, [slug, gearEff, selectedKit, panels, skillMode, tier])

  const byPick = useMemo(
    () => [...characters].sort((a, b) => tierView(b.slug, tier).pickRate - tierView(a.slug, tier).pickRate),
    [tier],
  )
  const gridChars = q
    ? characters.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.slug.includes(q))
    : [...byPick.filter((c) => favs.includes(c.slug)), ...byPick.filter((c) => !favs.includes(c.slug))]
  const char = characters.find((c) => c.slug === slug)!
  const myView = tierView(slug, tier)
  const role = myView.role
  const build = buildBySlug[slug]
  const presets: [string, number][] = [
    ['초반', Math.max(1, Math.round(maxStage * 0.3))],
    ['중반', Math.round(maxStage * 0.6)],
    ['후반', maxStage],
  ]

  // 자동 세팅 요약
  const autoSummary = useMemo(() => {
    const slots = gearSlotsOf(slug, tier)
    return GEAR_SLOT_ORDER.filter((s) => gearEff[s]?.level).map((s) => ({
      slot: SLOT_SHORT[s] ?? s,
      lv: gearEff[s].level,
      icon: slots[s]?.[gearEff[s].item]?.icon ?? slots[s]?.[0]?.icon ?? '',
      name: slots[s]?.[gearEff[s].item]?.name ?? '',
    }))
  }, [gearEff, slug, tier])

  return (
    <div className="app">
      <header className="topbar">
        <h1>사이퍼즈 킷 시뮬레이터</h1>
        <span className="date">넥슨·Neople 통계 {metaScrapedAt}</span>
      </header>

      {/* 캐릭터 + 모드 (이름 클릭 → 선택 그리드 확장) */}
      <section className={pickerOpen ? 'panel hero open' : 'panel hero'}>
        <div className="hero-bar">
          <button
            className={pickerOpen ? 'hero-id open' : 'hero-id'}
            onClick={() => { setPickerOpen((o) => !o); setQ('') }}
            title="캐릭터 선택"
          >
            <img className="hero-face" src={iconUrl(slug)} alt="" onError={hideOnError} />
            <span className="hero-name">
              <b>{char.name}</b>
              <small>{role === 'tank' ? '탱커' : '딜러'} · <em>캐릭터 선택</em></small>
            </span>
            <i className="chev">{pickerOpen ? '▴' : '▾'}</i>
          </button>
          <button className="favbtn" onClick={() => toggleFav(slug)} title="즐겨찾기">{favs.includes(slug) ? '★' : '☆'}</button>
          {twoModes && (
            <span className="seg">
              {(['1st', '2nd'] as const).map((m) => (
                <button key={m} className={skillMode === m ? 'on' : ''} onClick={() => setSkillMode(m)}>
                  {m === '1st' ? '1궁' : '2궁'}
                </button>
              ))}
            </span>
          )}
          <div className="mode-right">
            <span className="seg" title="통계 티어 (주간 기준)">
              {TIERS.map((t) => (
                <button key={t} className={tier === t ? 'on' : ''} onClick={() => selectTier(t)}>
                  {TIER_LABELS[t]}
                </button>
              ))}
            </span>
            <span className="seg big">
              <button className={setting === 'auto' ? 'on' : ''} onClick={() => setSetting('auto')}>자동 세팅</button>
              <button className={setting === 'manual' ? 'on' : ''} onClick={() => { setSetting('manual'); setMyGear((g) => g ?? autoGear(slug, stageEff, tier)) }}>수동 세팅</button>
            </span>
          </div>
        </div>

        {pickerOpen && (
          <div className="hero-picker">
            <div className="pick-bar">
              <span className="pick-ico"><i>⌕</i></span>
              <input
                className="pick-search"
                type="search"
                placeholder="캐릭터 검색…"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return // 한글 IME 조합 중 Enter 무시
                  if (e.key === 'Escape') { setQ(''); setPickerOpen(false) }
                  if (e.key === 'Enter' && gridChars[0]) selectChar(gridChars[0].slug)
                }}
              />
            </div>
            {!q && favs.length > 0 && <div className="pick-sec">★ 즐겨찾기</div>}
            <div className="pick-grid">
              {gridChars.map((c) => (
                <button key={c.slug} className={c.slug === slug ? 'ctile on' : 'ctile'} onClick={() => selectChar(c.slug)} title={c.name}>
                  <img src={iconUrl(c.slug)} alt="" loading="lazy" onError={hideOnError} />
                  <span>{c.name}</span>
                  {favs.includes(c.slug) && <i className="fav-dot" />}
                </button>
              ))}
              {gridChars.length === 0 && <span className="pick-empty">검색 결과 없음</span>}
            </div>
          </div>
        )}
      </section>

      {/* 자동 세팅 */}
      {setting === 'auto' && (
        <section className="panel auto">
          <div className="auto-row">
            <span className="lbl">게임 시점</span>
            <input type="range" min={1} max={maxStage} value={stageEff} onChange={(e) => setStage(+e.target.value)} />
            <span className="seg">
              {presets.map(([label, v]) => (
                <button key={label} className={stageEff === v ? 'on' : ''} onClick={() => setStage(v)}>{label}</button>
              ))}
            </span>
            <span className="stage-n"><b>{stageEff}</b>/{maxStage}구매</span>
          </div>
          <div className="auto-sum">
            <span className="lbl">지금 세팅</span>
            {autoSummary.map((s) => (
              <span key={s.slot} className="gchip" title={s.name}>
                {s.icon && <img src={itemIcon(s.icon)} alt="" loading="lazy" onError={hideOnError} />}
                {s.slot}<b>{s.lv}</b>
              </span>
            ))}
            {build && <span className="src">대세 순서 · {build.samples}판 집계</span>}
          </div>
        </section>
      )}

      {/* 수동 세팅 */}
      {setting === 'manual' && (
        <section className="manual">
          <GearPanel
            slug={slug}
            tier={tier}
            gear={gearEff}
            onChange={setMyGear}
            title="내 장비"
            action={{ label: '대세 세팅 ↺', onClick: () => setMyGear(autoGear(slug, maxStage, tier)) }}
          />
          <div className="panel opp">
            <div className="gp-head">
              <span>상대 세팅</span>
              <span className="seg">
                <button className={oppType === 'field' ? 'on' : ''} onClick={() => setOppType('field')}>실전 평균</button>
                <button className={oppType === 'single' ? 'on' : ''} onClick={() => setOppType('single')}>1:1 직접</button>
              </span>
            </div>
            {oppType === 'field' ? (
              <p className="opp-note">입장률로 가중한 상대 전체(딜러/탱커 구분) · 내 구매 수({gearLevelCount(gearEff)})에 맞춘 진행도</p>
            ) : (
              <>
                <div className="gp-row">
                  <span className="gp-slot">캐릭터</span>
                  <select className="gp-item" value={oppSlug} onChange={(e) => { setOppSlug(e.target.value); setOppGear(null); setOppKitIdx(0) }}>
                    {characters.map((c) => (
                      <option key={c.slug} value={c.slug}>{c.name}</option>
                    ))}
                  </select>
                  <span className="gp-role">{tierView(oppSlug, tier).role === 'tank' ? '탱커' : '딜러'}</span>
                </div>
                <div className="gp-row">
                  <span className="gp-slot">방어킷</span>
                  <select className="gp-item" value={oppKitIdx} onChange={(e) => setOppKitIdx(+e.target.value)}>
                    {oppKits.map((k, i) => (
                      <option key={i} value={i}>{k.name === '킷 없음' ? '킷 없음' : `${k.name.trim()} (${kitStat(k)})`}</option>
                    ))}
                  </select>
                </div>
                <GearPanel
                  slug={oppSlug}
                  tier={tier}
                  gear={oppGear ?? fullGear(oppSlug, tier)}
                  onChange={setOppGear}
                  title={`${characters.find((c) => c.slug === oppSlug)?.name} 장비`}
                  action={{ label: '풀빌드 ↺', onClick: () => setOppGear(fullGear(oppSlug, tier)) }}
                />
              </>
            )}
          </div>
        </section>
      )}

      {/* 공격킷 */}
      <section className="panel kits">
        <div className="kits-head">
          <span className="kh-title">공격킷</span>
          {fieldMode && (
            <span className="kh-sort">
              <span className="lbl">정렬</span>
              {([['all', '종합'], ['dealer', '딜러'], ['tank', '탱커'], ['armor', '방탱'], ['evade', '회탱']] as const).map(([v, label]) => (
                <button
                  key={v}
                  className={`${kitSort === v ? 'on' : ''} ${v}`}
                  onClick={() => setKitSort(v)}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
          <span className="kh-legend">
            ★ 종합 최적
            {fieldMode && <> · <em className="t-dealer">딜러</em> <em className="t-armor">방탱</em> <em className="t-evade">회탱</em> (●=1위)</>}
          </span>
        </div>
        <div className="kit-chips">
          {sortedKits.map(({ kit, per }) => {
            const sig = kitSig(kit)
            return (
              <button key={sig} className={sig === kitSig(selectedKit) ? 'chip on' : 'chip'} onClick={() => setSelKitSig(sig)} title={kitStat(kit)}>
                {sig === bestSig && <i>★</i>}
                {kit.icon && <img src={itemIcon(kit.icon)} alt="" loading="lazy" onError={hideOnError} />}
                <b>{kitName(kit)}</b>
                {fieldMode ? (
                  <span className="tri">
                    {per.map((v, i) => (
                      <span key={i} className={`tnum ${TONES[i]}`}>
                        {bestPerTarget[i] === sig && <em>●</em>}{fmt(v)}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="tri"><span className="tnum">{fmt(per[0])}</span></span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* 결과 */}
      <section className={fieldMode ? 'results five' : 'results'}>
        {sims.map((s, i) => (
          <ResultPanel key={i} title={s.title} sub={s.sub} tone={s.tone} sim={s.sim} noKit={s.noKit} />
        ))}
      </section>

      <footer className="foot">
        스킬 계수·아이템 레벨은 공식/게임 값, 상대 세팅·빌드 순서는 넥슨·Neople 통계 (랭커 {build ? build.samples.toLocaleString() : '—'}판 기준).
        방어 스탯 변환은 근사 — 절대값보다 킷 간 비교를 신뢰하세요.
      </footer>
    </div>
  )
}
