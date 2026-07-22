import { Fragment, useEffect, useMemo, useState } from 'react'
import './App.css'
import { characters } from './data/characters'
import { iconNum } from './data/icons'
import { buildBySlug } from './data/buildorder'
import {
  attackKitOptions,
  defenseKitOptions,
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
  defenderFrom,
  fullGear,
  gearSlotsOf,
  getSkills,
  hasTwoModes,
  hpFrom,
  incomingField,
  incomingSim,
  evalUpgradePath,
  kitUsage,
  maxStageOf,
  mergeFields,
  optimizeUpgradeOrder,
  rankDefKits,
  rankKits,
  simulate,
  singleTarget,
  subFieldTarget,
  type GearState,
  type IncomingAttacker,
  type IncomingResult,
  type SimResult,
  type SkillClass,
  type Target,
  type UpgradeStep,
  type UpoObjective,
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
// 방어킷 후보 — hp/회피/방어% 축이라 dominated 필터는 부적합
const defOptions: KitOption[] = [NONE_KIT, ...defenseKitOptions]

const CLS_LABEL: Record<SkillClass, string> = { basic: '평타', skill: '스킬', grab: '잡기', ult: '궁' }
const SLOT_SHORT: Record<string, string> = {
  '손(공격)': '손', '머리(치명)': '머리', '가슴(체력)': '가슴', '허리(회피)': '허리',
  '다리(방어)': '다리', '발(이동)': '발', 목: '목',
  장신구1: '장신1', 장신구2: '장신2', 장신구3: '장신3', 장신구4: '장신4',
}
// 강화 순서 추천 칩 약칭 (셔츠·바지·링)
const UPO_SHORT: Record<string, string> = {
  '손(공격)': '손', '머리(치명)': '머리', '가슴(체력)': '셔츠', '허리(회피)': '허리',
  '다리(방어)': '바지', '발(이동)': '발', 목: '목',
  장신구1: '링', 장신구2: '링', 장신구3: '링', 장신구4: '링', 장신구ALL: '링',
}
// 슬롯별 톤 클래스 (기존 role 색과 어울리게)
const UPO_TONE: Record<string, string> = {
  '가슴(체력)': 'hp', 목: 'hp', '다리(방어)': 'armor', '허리(회피)': 'evade',
  '손(공격)': 'atk', '머리(치명)': 'atk',
}
const fmt = (n: number) => Math.round(n).toLocaleString()
const FORMULA_TIP = [
  '데미지 = (고정 + 계수×공격력) × 대인계수 × (1+스킬 추가공격력) × 치명·회피 × (1 − 방어×(1−관통))',
  '',
  '· 치명 − 회피 = 단리 대결: 차이만큼 치명(×1.3+치명피해) 또는 회피(×0.4)',
  '· 우선구매 특전: 손 3구매 관통 +3%, 가슴 3구매 체력 +5%',
  '· 잡기(F)는 사이클에서 제외, 패널 대표값 = 사이클 + 궁 1회',
  '· 상대도 같은 게임 시점의 대세 세팅을 입은 것으로 가정',
].join('\n')

const FIELD_LABELS = ['딜러', '방탱', '회탱'] as const
// 방어킷 칩·피격 패널은 [딜러, 탱커] 2분할
const DEF_TONES = ['dealer', 'tank'] as const
const DEF_FIELD_LABELS = ['딜러', '탱커'] as const
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
// 방어킷 표시 이름 — 타즈·플래쉬만 캐릭터별 접두사("배트 타즈"…)가 붙으므로 그것만 떼고,
// 나머지(솔리드 스위퍼·닷지 실피드·바이벤 스테민II 등)는 고유 이름이라 그대로 유지.
// "방어"는 기본 방어킷(방어%만) → 명확히 표기.
function defKitName(k: KitOption): string {
  const n = k.name.trim()
  if (n === '킷 없음') return '킷 없음'
  if (n === '방어') return '방어(기본)'
  if (/\s타즈$/.test(n)) return '타즈'
  if (/\s플래쉬$/.test(n)) return '플래쉬'
  return n
}
// 킷 착용률 뱃지 (필드 전체·입장률 가중) — NONE_KIT은 뱃지 없음
function usageBadge(usage: Map<string, number>, k: KitOption) {
  if (k.name === '킷 없음') return null
  const u = usage.get(kitSig(k)) ?? 0
  if (u <= 0) return null
  const txt = u < 0.005 ? '<1%' : `${Math.round(u * 100)}%`
  return <span className="use" title="필드 전체 착용률 (입장률 가중)">{txt}</span>
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
  slug, tier, gear, onChange, title, action, footer,
}: {
  slug: string
  tier: Tier
  gear: GearState
  onChange: (g: GearState) => void
  title: string
  action?: { label: string; onClick: () => void }
  footer?: React.ReactNode
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
      {footer}
    </div>
  )
}

/* ---------- 결과 패널 (표) ---------- */
type Tone = 'dealer' | 'armor' | 'evade' | 'single' | 'tank' | 'overall'
/** 패널의 통계적 근거 한 줄: 이 상대 그룹의 가중치가 어떤 통계에서 왔는지 */
interface StatBasis {
  line: string // 예: "탱커 중 54% — 방어킷 착용 통계"
  tip: string // hover 상세: 유도 과정 + 표본
}
function ResultPanel({
  title, sub, tone, sim, noKit, stat,
}: {
  title: string
  sub: string
  tone: Tone
  sim: SimResult
  noKit: SimResult
  stat?: StatBasis
}) {
  const pctHp = (d: number) => `${Math.round((d / sim.hp) * 100)}`
  const kills = (sim.hp / sim.cyclePlusUlt).toFixed(2)
  const ult = sim.cyclePlusUlt - sim.cycle
  const gain = Math.round((sim.cyclePlusUlt / (noKit.cyclePlusUlt || 1) - 1) * 100)
  // 원사이클 처치 등급: noult(궁 없이도 처치=최상) > ult(궁 포함 처치) > none
  const killTier = sim.cycle >= sim.hp ? 'noult' : sim.cyclePlusUlt >= sim.hp ? 'ult' : 'none'
  const bigTip = `사이클 ${fmt(sim.cycle)} + 궁 ${fmt(ult)} = ${fmt(sim.cyclePlusUlt)}\n상대 평균 HP ${fmt(sim.hp)} → ${kills}번 처치`
  const killTip = killTier === 'noult' ? '궁 없이 한 사이클에 처치 (최상)' : killTier === 'ult' ? '궁 포함 한 사이클에 처치' : undefined
  // 사이클+궁 데미지 범위 + 각 케이스의 컷(원킬) 여부
  const rMin = sim.cyclePlusUltMin, rMax = sim.cyclePlusUltMax
  const hasRange = rMax - rMin > 1
  const clampPct = (x: number) => Math.min(100, Math.max(0, x))
  const span = rMax - rMin || 1
  const expPos = clampPct(((sim.cyclePlusUlt - rMin) / span) * 100)
  const hpPct = clampPct(((sim.hp - rMin) / span) * 100) // 처치선(상대 HP) 위치
  const worstKill = rMin >= sim.hp, bestKill = rMax >= sim.hp
  const fmtCut = (dmg: number) => { const c = sim.hp / dmg; return c <= 9.99 ? c.toFixed(2) : '9+' }
  // 궁 단독 원킬: exp=기대값으로도 원킬 / max=치명 최대치로만 원킬
  const ultOS = sim.ult >= sim.hp ? 'exp' : sim.ultMax >= sim.hp ? 'max' : 'none'
  const ultOSTip = ultOS === 'exp'
    ? `궁 기대 데미지 ${fmt(sim.ult)} ≥ 상대 HP ${fmt(sim.hp)} — 궁 한 방에 처치`
    : `치명 최대 궁 ${fmt(sim.ultMax)} ≥ 상대 HP ${fmt(sim.hp)} — 치명타가 터지면 궁 한 방`
  return (
    <div className={`rp ${tone}`}>
      <div className="rp-head">
        <span className="rp-title">{title} <em>{sub}</em></span>
        <span className="rp-big" title={bigTip}>
          <b>{fmt(sim.cyclePlusUlt)}</b>
          <span className={killTier === 'none' ? 'rp-kill' : `rp-kill k-${killTier}`} title={killTip}>
            {killTier === 'noult' && <em className="klabel">✓ 궁없이 </em>}
            {killTier === 'ult' && <em className="klabel">궁포함 </em>}
            {kills}컷
          </span>
        </span>
      </div>
      {stat && (
        <div className="rp-basis" title={stat.tip}>
          {stat.line}
          <i>ⓘ</i>
        </div>
      )}
      <table>
        <thead>
          <tr><th className="l">스킬</th><th>공식</th><th>데미지</th><th>HP%</th></tr>
        </thead>
        <tbody>
          {sim.skills.map(({ skill, cls, damage, damageMin, damageMax }) => (
            <tr key={skill.name} className={cls}>
              <td className="l">
                <i>{CLS_LABEL[cls]}</i>
                {skill.name}
              </td>
              <td className="f">{formula(skill.hits)}</td>
              <td className="d">
                {fmt(damage)}
                {damageMax - damageMin > 1 && <em className="rng">{fmt(damageMin)}~{fmt(damageMax)}</em>}
              </td>
              <td className={damage >= sim.hp ? 'h os' : 'h'}
                title={damage >= sim.hp ? '이 스킬 한 번으로 처치 (기대 데미지 ≥ 상대 HP)' : undefined}>
                {damage >= sim.hp ? '원킬' : pctHp(damage)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasRange && (
        <div className="rp-range" title="치명·회피에 따른 사이클+궁 범위. 세로선=상대 HP(처치선), 오른쪽=원킬 구간. ✓=그 케이스에서 원킬">
          <span className="lo">
            <span className="dmg">최악 <b>{fmt(rMin)}</b></span>
            <em className={worstKill ? 'cut kill' : 'cut'}>{worstKill && '✓ '}{fmtCut(rMin)}컷</em>
          </span>
          <span className="track" style={{ background: `linear-gradient(90deg, var(--line-2) 0 ${hpPct}%, var(--role) ${hpPct}% 100%)` }}>
            {hpPct > 1 && hpPct < 99 && <span className="hp" style={{ left: `${hpPct}%` }} />}
            <i style={{ left: `${expPos}%` }} />
          </span>
          <span className="hi">
            <span className="dmg"><b>{fmt(rMax)}</b> 최대</span>
            <em className={bestKill ? 'cut kill' : 'cut'}>{bestKill && '✓ '}{fmtCut(rMax)}컷</em>
          </span>
        </div>
      )}
      <div className="rp-sub">
        <span>궁 제외 <b>{fmt(sim.cycle)}</b></span>
        <span>궁 포함 <b>{fmt(sim.cyclePlusUlt)}</b></span>
        {sim.grab > 0 && <span>＋잡기 <b>{fmt(sim.cyclePlusGrab)}</b></span>}
        {ultOS !== 'none' && (
          <span className={`rp-osu ${ultOS}`} title={ultOSTip}>⚡ {ultOS === 'exp' ? '궁 원킬' : '치명시 궁 원킬'}</span>
        )}
        <span className="ke">킷 효과 <b className={gain >= 0 ? 'up' : 'down'}>{gain >= 0 ? '+' : ''}{gain}%</b></span>
      </div>
    </div>
  )
}

/* ---------- 피격 패널 (ResultPanel 미러 — 받는 피해·생존) ---------- */
interface DefPanelData {
  title: string
  sub: string
  tone: Tone
  res: IncomingResult
  noRes: IncomingResult
  myHp: number
  noHp: number
  stat?: StatBasis
}
function DefensePanel({ title, sub, tone, res, noRes, myHp, noHp, stat }: DefPanelData) {
  const inc = res.cyclePlusUlt.exp // 받는 사이클+궁 기대 피해
  const cuts = inc > 0 ? myHp / inc : Infinity
  const cutsLabel = Number.isFinite(cuts) ? (cuts <= 9.99 ? cuts.toFixed(2) : '9+') : '∞'
  // 위험 등급: 궁 없이도 사망(noult=최악) > 궁 포함 사망(ult) > 버팀(none)
  const killTier = res.cycle.exp >= myHp ? 'noult' : inc >= myHp ? 'ult' : 'none'
  const bigTip = `사이클 ${fmt(res.cycle.exp)} + 궁 ${fmt(inc - res.cycle.exp)} = ${fmt(inc)}\n내 HP ${fmt(myHp)} → ${cutsLabel}컷에 사망`
  const killTip = killTier === 'noult' ? '상대 사이클만으로 한 번에 사망 (매우 위험)'
    : killTier === 'ult' ? '상대 사이클+궁에 한 번에 사망' : '한 사이클+궁을 버팀'
  // 받는 피해 범위 (최소=유리 ~ 최대=위험) + 생존/사망
  const rMin = res.cyclePlusUlt.min, rMax = res.cyclePlusUlt.max
  const hasRange = rMax - rMin > 1
  const clampPct = (x: number) => Math.min(100, Math.max(0, x))
  const span = rMax - rMin || 1
  const expPos = clampPct(((inc - rMin) / span) * 100)
  const hpPct = clampPct(((myHp - rMin) / span) * 100) // 처치선(내 HP) 위치
  const deadMin = rMin >= myHp, deadMax = rMax >= myHp
  const fmtSurv = (dmg: number) => { const c = myHp / dmg; return c <= 9.99 ? c.toFixed(2) : '9+' }
  // 방어킷 효과 = 킷 없음 대비 생존 사이클 증가율
  const survKit = inc > 0 ? myHp / inc : Infinity
  const survNo = noRes.cyclePlusUlt.exp > 0 ? noHp / noRes.cyclePlusUlt.exp : Infinity
  const gain = Number.isFinite(survKit) && Number.isFinite(survNo) && survNo > 0 ? Math.round((survKit / survNo - 1) * 100) : 0
  const pctHp = (d: number) => `${Math.round((d / myHp) * 100)}`
  return (
    <div className={`rp ${tone}`}>
      <div className="rp-head">
        <span className="rp-title">{title} <em>{sub}</em></span>
        <span className="rp-big" title={bigTip}>
          <b>{fmt(inc)}</b>
          <span className={killTier === 'none' ? 'rp-kill' : `rp-kill k-${killTier}`} title={killTip}>
            {killTier === 'noult' && <em className="klabel">궁없이 </em>}
            {killTier === 'ult' && <em className="klabel">궁포함 </em>}
            {cutsLabel}컷 {killTier === 'none' ? '버팀' : '사망'}
          </span>
        </span>
      </div>
      {stat && (
        <div className="rp-basis" title={stat.tip}>
          {stat.line}
          <i>ⓘ</i>
        </div>
      )}
      <table>
        <thead>
          <tr><th className="l">위협 TOP {res.top5.length || ''}</th><th>사이클+궁</th><th>내 HP%</th></tr>
        </thead>
        <tbody>
          {res.top5.map(({ slug: s, dmg }) => (
            <tr key={s}>
              <td className="l"><img className="th-face" src={iconUrl(s)} alt="" loading="lazy" onError={hideOnError} />{characters.find((c) => c.slug === s)?.name ?? s}</td>
              <td className="d">{fmt(dmg)}</td>
              <td className="h">{pctHp(dmg)}</td>
            </tr>
          ))}
          {res.top5.length === 0 && <tr><td className="l" colSpan={3}>공격자 없음</td></tr>}
        </tbody>
      </table>
      {hasRange && (
        <div className="rp-range" title="치명·회피에 따른 받는 피해 범위. 세로선=내 HP(처치선), 오른쪽=사망 구간. ✓=그 케이스에서 사망">
          <span className="lo">
            <span className="dmg">최소 <b>{fmt(rMin)}</b></span>
            <em className={deadMin ? 'cut kill' : 'cut'}>{deadMin ? '✓ 사망' : `${fmtSurv(rMin)}컷 버팀`}</em>
          </span>
          <span className="track" style={{ background: `linear-gradient(90deg, var(--line-2) 0 ${hpPct}%, var(--role) ${hpPct}% 100%)` }}>
            {hpPct > 1 && hpPct < 99 && <span className="hp" style={{ left: `${hpPct}%` }} />}
            <i style={{ left: `${expPos}%` }} />
          </span>
          <span className="hi">
            <span className="dmg"><b>{fmt(rMax)}</b> 최대</span>
            <em className={deadMax ? 'cut kill' : 'cut'}>{deadMax ? '✓ 사망' : `${fmtSurv(rMax)}컷 버팀`}</em>
          </span>
        </div>
      )}
      <div className="rp-sub">
        <span>궁 제외 <b>{fmt(res.cycle.exp)}</b></span>
        <span>궁 포함 <b>{fmt(inc)}</b></span>
        <span>내 HP <b>{fmt(myHp)}</b></span>
        <span className="ke">방어킷 효과 <b className={gain >= 0 ? 'up' : 'down'}>{gain >= 0 ? '+' : ''}{gain}%</b></span>
      </div>
    </div>
  )
}

/* ---------- 섹션 헤더 (제목 + 서브타이틀) ---------- */
function SecHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="sec-head">
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
  )
}

// 강화 순서 값 포맷 — defense=생존 컷, attack=한타 딜
const upoVal = (v: number, kind: 'attack' | 'defense', prec = 1) =>
  kind === 'defense' ? `${v.toFixed(prec)}컷` : fmt(v)
// 단계 이득(Δ) 포맷
const upoGain = (g: number, kind: 'attack' | 'defense') =>
  kind === 'defense' ? `${g >= 0 ? '+' : ''}${g.toFixed(2)}` : `${g >= 0 ? '+' : ''}${fmt(g)}`

// 코인 가중 평균값(=값 곡선의 면적 ÷ 총코인) — 순서가 게임 전체에 걸쳐 얼마나 앞섰는지.
// 종점(완성)은 세 순서 모두 같으므로, 경로(면적)만이 순서의 우열을 가른다.
function upoAvg(steps: UpgradeStep[]): number {
  if (!steps.length) return 0
  const base = steps[0].value - steps[0].gain
  const pts = [{ x: 0, y: base }, ...steps.map((s) => ({ x: s.cumCoin, y: s.value }))]
  let area = 0
  for (let i = 0; i < pts.length - 1; i++) area += pts[i].y * (pts[i + 1].x - pts[i].x)
  return area / (pts[pts.length - 1].x || 1)
}

// 강화 순서 값 곡선 비교 (Y=값, X=누적 코인 · 세 순서를 선으로, marks=컷 기준선)
// hpCurve=단계별 상대 HP(원콤선) — 상대가 함께 성장하면 기울고, 풀빌드면 평평해짐
// activeTone 곡선엔 구매마다 점을 찍음 — hoverIdx(리스트 호버 단계)는 크게, mileIdx(컷 달성)는 골드로
function UpgradeChart({ curves, kind, marks = [], hpCurve, activeTone, hoverIdx, mileIdx }: {
  curves: { tone: string; steps: UpgradeStep[] }[]
  kind: 'attack' | 'defense'
  marks?: { y: number; label: string }[]
  hpCurve?: { x: number; y: number }[]
  activeTone?: string
  hoverIdx?: number | null
  mileIdx?: Set<number>
}) {
  const W = 600, H = 190, padL = 42, padR = 10, padT = 14, padB = 24
  const series = curves.map((c) => ({
    tone: c.tone,
    // 시작점(빈 장비 값 = 1수 value − gain)을 앞에 붙여 0코인부터 그림
    pts: c.steps.length
      ? [{ x: 0, y: c.steps[0].value - c.steps[0].gain }, ...c.steps.map((s) => ({ x: s.cumCoin, y: s.value }))]
      : [],
  }))
  const all = series.flatMap((s) => s.pts)
  if (!all.length) return null
  const maxX = Math.max(...all.map((p) => p.x)) || 1
  const ys = [...all.map((p) => p.y), ...marks.map((m) => m.y), ...(hpCurve ?? []).map((p) => p.y)] // 기준선도 범위에 포함
  const minY = Math.min(...ys), maxY = Math.max(...ys) || 1
  const spanY = maxY - minY || 1
  const sx = (x: number) => padL + (x / maxX) * (W - padL - padR)
  const sy = (y: number) => padT + (1 - (y - minY) / spanY) * (H - padT - padB)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="upo-chart" role="img" aria-label="강화 순서 값 곡선">
      {[minY, (minY + maxY) / 2, maxY].map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={sy(t)} x2={W - padR} y2={sy(t)} className="upo-grid" />
          <text x={padL - 6} y={sy(t) + 3} className="upo-ytick" textAnchor="end">{upoVal(t, kind)}</text>
        </g>
      ))}
      {[0, maxX / 2, maxX].map((t, i, a) => (
        <text key={i} x={sx(t)} y={H - 7} className="upo-xtick"
          textAnchor={i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle'}>
          {Math.round(t / 1000)}k
        </text>
      ))}
      {marks.map((m, i) => (
        <g key={`m${i}`}>
          <line x1={padL} y1={sy(m.y)} x2={W - padR} y2={sy(m.y)} className="upo-mark" />
          <text x={W - padR - 3} y={sy(m.y) - 4} className="upo-mark-lbl" textAnchor="end">{m.label}</text>
        </g>
      ))}
      {hpCurve && hpCurve.length > 1 && (
        <g>
          <polyline className="upo-hpline" points={hpCurve.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')} />
          <text x={W - padR - 3} y={sy(hpCurve[hpCurve.length - 1].y) - 4} className="upo-mark-lbl" textAnchor="end">상대 HP</text>
        </g>
      )}
      {series.map((s) => s.pts.length > 1 && (
        <polyline key={s.tone}
          className={`upo-line ${s.tone}${activeTone && s.tone !== activeTone ? ' dim' : ''}`}
          points={s.pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')} />
      ))}
      {/* 선택 순서의 구매 지점 — pts[0]=시작점이라 단계 i는 pts[i+1] */}
      {activeTone && (() => {
        const act = series.find((s) => s.tone === activeTone)
        if (!act || act.pts.length < 2) return null
        return act.pts.slice(1).map((p, i) => {
          const mile = mileIdx?.has(i)
          const hover = hoverIdx === i
          return (
            <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={hover ? 5 : mile ? 3.6 : 2.2}
              className={`upo-dot ${activeTone}${mile ? ' mile' : ''}${hover ? ' hover' : ''}`} />
          )
        })
      })()}
    </svg>
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
  const [selDefKitSig, setSelDefKitSig] = useState<string | null>(null) // 내 방어킷 (null → 추천 1위)
  const [oppType, setOppType] = useState<'field' | 'single'>('field')
  const [kitSort, setKitSort] = useState<string>('all') // all=종합, dealer, armor, evade, tank(방탱+회탱)
  const [upoView, setUpoView] = useState<'eff' | 'greedy' | 'rank'>('eff') // 강화 순서 보기
  // 강화 순서의 상대 진행도. 기본 full — 상대가 나와 같이 크면 원콤이 항상 참이라
  // 마일스톤이 정보를 잃음("완성된 상대를 한 콤보에 잡는 시점"이 의미 있는 질문)
  const [upoOpp, setUpoOpp] = useState<'sync' | 'full'>('full')
  // 공격 목표값. 기본 contrib(총 딜 기여 = 딜 × 생존 사이클) — burst만 쓰면
  // 죽는 걸 계산에 안 넣어 셔츠(체력)를 끝까지 안 사는 문제가 있음
  const [upoObj, setUpoObj] = useState<UpoObjective>('contrib')
  const [methodOpen, setMethodOpen] = useState(true)
  const [simView, setSimView] = useState<'attack' | 'defense'>('attack') // 공격/방어 탭
  // 로드맵이 실제로 끼는 목걸이 — 탭 성향(공격=공목/방어=방목)에 맞는 후보가
  // 메타에 없으면 폴백되므로, 라벨은 탭이 아니라 '실제 고른 것'에서 유도해야 정확
  const upoNeck = useMemo(() => {
    const cands = gearSlotsOf(slug, tier)['목']
    if (!cands?.length) return null
    const isDef = (c: (typeof cands)[number]) => (c.total.defenseReduction ?? 0) > 0
    const i = cands.findIndex((c) => (simView === 'attack' ? !isDef(c) : isDef(c)))
    const chosen = cands[i >= 0 ? i : 0]
    return { name: chosen.name, def: isDef(chosen), matched: i >= 0 }
  }, [slug, tier, simView])

  // 캐릭터 모달 열림 동안 배경 스크롤 잠금
  useEffect(() => {
    if (!pickerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [pickerOpen])
  const [oppSlug, setOppSlug] = useState('jekiel')
  const [oppGear, setOppGear] = useState<GearState | null>(null)
  const [oppKitIdx, setOppKitIdx] = useState(0)

  const maxStage = maxStageOf(slug, tier)
  const stageEff = Math.min(stage ?? maxStage, maxStage)
  const twoModes = hasTwoModes(slug)

  const selectChar = (s: string) => {
    setSlug(s); setStage(null); setMyGear(null); setSelKitSig(null); setSelDefKitSig(null); setSkillMode('1st'); setQ(''); setPickerOpen(false)
  }
  const selectTier = (t: Tier) => {
    setTier(t); setMyGear(null); setOppGear(null); setSelKitSig(null); setSelDefKitSig(null); setOppKitIdx(0)
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
  // 킷 착용률 (필드 전체·입장률 가중, 티어별 캐싱)
  const atkUsage = useMemo(() => kitUsage(tier, 'attack'), [tier])
  const defUsage = useMemo(() => kitUsage(tier, 'defense'), [tier])
  const sortedKits = useMemo(() => {
    if (sortKey === 'usage') {
      return [...kitRank].sort((a, b) => (atkUsage.get(kitSig(b.kit)) ?? 0) - (atkUsage.get(kitSig(a.kit)) ?? 0))
    }
    if (sortKey === 'all') return kitRank
    return [...kitRank].sort((a, b) => kitScore(b.per, sortKey) - kitScore(a.per, sortKey))
  }, [kitRank, sortKey, atkUsage])

  // 방어킷 추천 — 필드가 내게 넣는 피해로 생존 사이클 수 산정 (필드 모드 전용)
  const defRank = useMemo(() => {
    if (!fieldMode) return null
    const st = setting === 'auto' ? stageEff : gearLevelCount(gearEff)
    return rankDefKits(slug, gearEff, defOptions, st, tier)
  }, [fieldMode, slug, gearEff, setting, stageEff, tier])
  const defBestSig = defRank?.[0] ? kitSig(defRank[0].kit) : null
  const defBestPerTarget = useMemo(
    () => (defRank
      ? [0, 1].map((i) => {
          let best = defRank[0]
          for (const s of defRank) if (s.per[i] > (best?.per[i] ?? 0)) best = s
          return best ? kitSig(best.kit) : null
        })
      : [null, null]),
    [defRank],
  )
  const defNoneTotal = defRank?.find((s) => s.kit.name === '킷 없음')?.total ?? 0
  // 선택된 내 방어킷 (null → 추천 1위, 없으면 킷 없음)
  const selectedDefKit =
    (selDefKitSig ? defOptions.find((k) => kitSig(k) === selDefKitSig) : null) ?? defRank?.[0]?.kit ?? NONE_KIT

  // 나를 때리는 공격자 목록 — 방어킷과 무관 → 1회 구성 (방어킷 변경 시 incomingSim만 재계산)
  const incomingGroups = useMemo(() => {
    const st = setting === 'auto' ? stageEff : gearLevelCount(gearEff)
    if (setting === 'manual' && oppType === 'single') {
      const og = oppGear ?? fullGear(oppSlug, tier)
      const atkBase = attackerFrom(oppSlug, og, null, tier, true) // 킷 없는 기준 → 공격킷별로 파생
      const aks = tierView(oppSlug, tier).attackKits ?? []
      const akTotal = aks.reduce((s, k) => s + (k.pct ?? 0), 0) || 1
      const skills = getSkills(oppSlug, '1st').filter((s) => s.cls !== 'grab')
      // 상대 공격킷 착용 분포별 공격자 (킷 없으면 기준 1개, Σw=1)
      const single: IncomingAttacker[] = aks.length
        ? aks.map((k) => ({
            w: (k.pct ?? 0) / akTotal,
            atk: {
              ...atkBase,
              attack: atkBase.attack + (k.attack ?? 0),
              crit: atkBase.crit + (k.crit ?? 0),
              critDamage: atkBase.critDamage + (k.critDamage ?? 0) / 100,
              penetration: atkBase.penetration + (k.penetration ?? 0),
            },
            skills, slug: oppSlug,
          }))
        : [{ w: 1, atk: atkBase, skills, slug: oppSlug }]
      return { mode: 'single' as const, single }
    }
    const dealer = incomingField('dealer', st, tier, slug)
    const tank = [...incomingField('tankArmor', st, tier, slug), ...incomingField('tankEvade', st, tier, slug)]
    return { mode: 'field' as const, dealer, tank, all: [...dealer, ...tank] }
  }, [setting, oppType, oppSlug, oppGear, stageEff, gearEff, slug, tier])

  // 피격 패널 (선택 방어킷 vs 킷 없음) — 종합/딜러/탱커 or 1:1
  const defPanels = useMemo<DefPanelData[]>(() => {
    const myDef = defenderFrom(slug, gearEff, selectedDefKit, tier)
    const myHp = hpFrom(slug, gearEff, selectedDefKit, tier)
    const noDef = defenderFrom(slug, gearEff, NONE_KIT, tier)
    const noHp = hpFrom(slug, gearEff, NONE_KIT, tier)
    const nChars = (atks: IncomingAttacker[]) => new Set(atks.map((a) => a.slug)).size
    const defNote = '각 상대: 부위별 착용률(주간 통계)로 가중한 기대 세팅을 나와 같은 게임 시점까지 착용\n공격킷은 착용 분포대로 나눠 각 조합을 개별 상대로 계산 (한타 맞교환)'
    const mk = (title: string, sub: string, tone: Tone, atks: IncomingAttacker[], line?: string): DefPanelData => ({
      title, sub, tone, myHp, noHp,
      res: incomingSim(atks, myDef),
      noRes: incomingSim(atks, noDef),
      stat: line ? { line, tip: `${line}\n\n${defNote}` } : undefined,
    })
    if (incomingGroups.mode === 'single') {
      const name = characters.find((c) => c.slug === oppSlug)?.name ?? ''
      return [mk(`vs ${name}`, '1:1 직접 세팅', 'single', incomingGroups.single)]
    }
    const { dealer, tank, all } = incomingGroups
    const basis = (atks: IncomingAttacker[]) => `공격자 ${nChars(atks)}명 · 입장률 가중 · 공격킷 복용 가정`
    return [
      mk('종합', '실전 평균 전체', 'overall', all, basis(all)),
      mk('vs 딜러', '공격형 목걸이 상대가 때림', 'dealer', dealer, basis(dealer)),
      mk('vs 탱커', '방어형 목걸이 상대가 때림', 'tank', tank, basis(tank)),
    ]
  }, [incomingGroups, slug, gearEff, selectedDefKit, tier, oppSlug])

  // 필드 가중치 요약: 입장률·킷분포에서 유도된 각 그룹의 비중 (패널 stat + 계산 설명 공용)
  const shares = useMemo(() => {
    if (!fieldMode) return null
    const [d, a, e] = targets
    const w = (t: Target) => (t.kind === 'field' ? t.totalW : 0)
    // 비율 분할이라 한 캐릭이 딜러·탱커에 동시에 걸칠 수 있음 → 가중치>0인 고유 캐릭 수
    const slugsOf = (...ts: Target[]) =>
      new Set(ts.flatMap((t) => (t.kind === 'field' ? t.items.map((i) => i.slug) : [])))
    const dW = w(d), aW = w(a), eW = w(e)
    const tot = dW + aW + eW || 1
    return {
      dealer: dW / tot, tank: (aW + eW) / tot,
      armorInTank: aW / (aW + eW || 1), evadeInTank: eW / (aW + eW || 1),
      nDealers: slugsOf(d).size, nTanks: slugsOf(a, e).size,
    }
  }, [fieldMode, targets])

  // 실전 평균 상대의 프로필 — 평균 방어/회피/HP + 입장률 상위 얼굴 (수동 모드 상대 패널용)
  const fieldProfile = useMemo(() => {
    if (!fieldMode) return null
    const all = mergeFields(...targets)
    if (all.kind !== 'field' || !all.items.length) return null
    let r = 0, e = 0, h = 0
    const byChar = new Map<string, number>()
    for (const it of all.items) {
      r += it.def.reduction * it.w
      e += it.def.evade * it.w
      h += it.hp * it.w
      if (it.slug) byChar.set(it.slug, (byChar.get(it.slug) ?? 0) + it.w)
    }
    const W = all.totalW
    const roster = [...byChar.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s, w]) => ({ slug: s, name: characters.find((c) => c.slug === s)?.name ?? s, pct: w / W }))
    return {
      reduction: r / W, evade: e / W, hp: h / W, roster,
      pen: attackerFrom(slug, gearEff, selectedKit, tier).penetration,
    }
  }, [fieldMode, targets, slug, gearEff, selectedKit, tier])

  // 결과 패널 구성: 필드 모드=종합/딜러/탱커/방탱/회탱, 단일=1:1
  // 각 패널의 stat = 이 상대 그룹의 비중이 어떤 통계에서 유도됐는지
  const panels = useMemo(() => {
    if (!fieldMode) {
      const name = characters.find((c) => c.slug === oppSlug)?.name ?? ''
      return [{ target: targets[0], tone: 'single' as Tone, title: `vs ${name}`, sub: '1:1 직접 세팅', stat: undefined as StatBasis | undefined }]
    }
    const [d, a, e] = targets
    const w = (t: Target) => (t.kind === 'field' ? t.totalW : 0)
    const nChars = (t: Target) => (t.kind === 'field' ? new Set(t.items.map((i) => i.slug)).size : 1)
    const nDistinct = (...ts: Target[]) =>
      new Set(ts.flatMap((t) => (t.kind === 'field' ? t.items.map((i) => i.slug) : []))).size
    const dW = w(d), aW = w(a), eW = w(e)
    const tot = dW + aW + eW || 1
    const tankW = aW + eW || 1
    const pctS = (x: number) => `${Math.round(x * 100)}%`
    const settingNote = '각 상대의 세팅: 부위별 착용률(이 티어 주간 통계)로 가중한 기대 세팅을\n랭커 구매 순서에 따라 나와 같은 게임 시점까지 착용한 상태\n방어킷은 착용 분포대로 나눠 개별 반영'
    const splitNote = '각 캐릭터는 목걸이 착용 분포(공격형:방어형)대로 딜러/탱커에 비율로 나눠 반영\n→ 한 캐릭터가 딜러와 탱커 양쪽에 걸칠 수 있음'
    return [
      {
        target: mergeFields(d, a, e), tone: 'overall' as Tone, title: '종합', sub: '실전 평균 전체',
        stat: {
          line: `입장률 가중 — 딜러 ${pctS(dW / tot)} · 방탱 ${pctS(aW / tot)} · 회탱 ${pctS(eW / tot)}`,
          tip: `상대 = 이 티어에 입장한 전체 캐릭터 ${nDistinct(d, a, e)}명을 입장률로 가중한 기대값\n${splitNote}\n탱커 안의 방탱/회탱 비율: 각 탱커의 방어킷 착용 분포\n\n${settingNote}`,
        } as StatBasis | undefined,
      },
      {
        target: d, tone: 'dealer' as Tone, title: 'vs 딜러', sub: '공격형 목걸이 비중',
        stat: {
          line: `필드의 ${pctS(dW / tot)} · ${nChars(d)}명 — 입장률 통계 가중`,
          tip: `공격형 목걸이 착용 비율만큼 딜러로 반영된 ${nChars(d)}명\n각자 (입장률 × 딜러 비율)만큼 가중해 평균 · 목걸이는 공격형 후보만 반영\n\n${settingNote}`,
        } as StatBasis | undefined,
      },
      {
        target: mergeFields(a, e), tone: 'tank' as Tone, title: 'vs 탱커', sub: '방탱+회탱 종합',
        stat: {
          line: `필드의 ${pctS(tankW / tot)} · ${nChars(a)}명 — 입장률 통계 가중`,
          tip: `방어형 목걸이 착용 비율만큼 탱커로 반영된 ${nChars(a)}명\n아래 방탱/회탱을 방어킷 착용 비율로 합친 것과 동일 · 목걸이는 방어형 후보만 반영\n\n${settingNote}`,
        } as StatBasis | undefined,
      },
      {
        target: a, tone: 'armor' as Tone, title: 'vs 방탱', sub: '방어킷 착용 탱커',
        stat: {
          line: `탱커 중 ${pctS(aW / tankW)} — 방어킷 착용 통계`,
          tip: `각 탱커의 방어킷 착용 분포(주간)에서 방어형 킷(타즈 등) 비중만 합산\n→ 탱커 필드의 ${pctS(aW / tankW)}\n회탱과 합치면 탱커 전체가 됨 (총합 보존)\n\n${settingNote}`,
        } as StatBasis | undefined,
      },
      {
        target: e, tone: 'evade' as Tone, title: 'vs 회탱', sub: '회피킷 착용 탱커',
        stat: {
          line: `탱커 중 ${pctS(eW / tankW)} — 회피킷 착용 통계`,
          tip: `각 탱커의 방어킷 착용 분포(주간)에서 회피형 킷(플래쉬·실피드 등) 비중만 합산\n→ 탱커 필드의 ${pctS(eW / tankW)}\n방탱과 합치면 탱커 전체가 됨 (총합 보존)\n\n${settingNote}`,
        } as StatBasis | undefined,
      },
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

  // 강화 순서 추천 (자동 모드 전용) — 현재 탭(공격/방어)·선택 킷 기준 탐욕/효율 + 랭커 빌드
  // 무거우니 auto 모드일 때만 계산. 킷: 공격=선택 공격킷, 방어=선택 방어킷
  const upoKind: 'attack' | 'defense' = simView === 'attack' ? 'attack' : 'defense'
  const upoKit = simView === 'attack' ? selectedKit : selectedDefKit
  const upgradeOrders = useMemo(() => {
    if (setting !== 'auto') return null
    const rankerPath = (buildBySlug[slug]?.order ?? []).map((o) => ({ slot: o.slot, level: o.level }))
    const opp = upoOpp === 'sync' ? 'sync' : maxStageOf(slug, tier) // 상대 진행도
    return {
      greedy: optimizeUpgradeOrder(slug, upoKind, upoKit, tier, 'greedy', opp, upoObj),
      efficiency: optimizeUpgradeOrder(slug, upoKind, upoKit, tier, 'efficiency', opp, upoObj),
      ranker: evalUpgradePath(slug, upoKind, upoKit, tier, rankerPath, opp, upoObj),
    }
  }, [setting, slug, simView, upoKit, tier, upoOpp, upoObj])
  // 차트 컷 기준선: 공격=상대 HP 곡선(hpCurve)으로 대체, 방어=정수 컷(1컷/2컷…)
  const upoMarks = useMemo(() => {
    if (!upgradeOrders || upoKind === 'attack') return []
    const vals = [...upgradeOrders.efficiency, ...upgradeOrders.greedy, ...upgradeOrders.ranker].map((s) => s.value)
    if (!vals.length) return []
    const hi = Math.max(...vals)
    const marks: { y: number; label: string }[] = []
    for (let k = 1; k <= Math.floor(hi); k++) marks.push({ y: k, label: `${k}컷 버팀` })
    return marks
  }, [upgradeOrders, upoKind])
  // 세 순서 각각의 단계 + 컷 달성 마일스톤 — 전환 시 높이 고정을 위해 셋 다 미리 계산해 겹쳐 렌더
  const upoAll = useMemo(() => {
    if (!upgradeOrders) return null
    const miles = (steps: UpgradeStep[]) => {
      const m = new Map<number, { label: string; tone: string; strong?: boolean }[]>()
      if (!steps.length) return m
      const add = (i: number, label: string, tone: string, strong?: boolean) => {
        const a = m.get(i) ?? []
        a.push({ label, tone, strong })
        m.set(i, a)
      }
      if (upoKind === 'attack') {
        // 종합 + 그룹별: 사이클+궁(원콤) / 사이클만(궁없이 원콤)이 그 시점 그룹 평균 HP를 처음 넘는 구매
        // 상대도 함께 성장하면 기준 HP가 단계마다 달라져 고정 임계값 대신 단계별로 비교
        const hpAll = (s: UpgradeStep) => s.hp ?? Infinity
        const hpOf = (k: number) => (s: UpgradeStep) => s.perHp?.[k] ?? Infinity
        const goals: [string, string, (s: UpgradeStep) => number, (s: UpgradeStep) => number, boolean?][] = [
          ['평균 원콤', 'gold', hpAll, (s) => s.value],
          ['딜러 원콤', 'dealer', hpOf(0), (s) => s.per[0] ?? 0],
          ['방탱 원콤', 'armor', hpOf(1), (s) => s.per[1] ?? 0],
          ['회탱 원콤', 'evade', hpOf(2), (s) => s.per[2] ?? 0],
          ['궁없이 평균 원콤', 'gold', hpAll, (s) => s.noUlt ?? 0, true],
          ['궁없이 딜러 원콤', 'dealer', hpOf(0), (s) => s.perNoUlt?.[0] ?? 0, true],
          ['궁없이 방탱 원콤', 'armor', hpOf(1), (s) => s.perNoUlt?.[1] ?? 0, true],
          ['궁없이 회탱 원콤', 'evade', hpOf(2), (s) => s.perNoUlt?.[2] ?? 0, true],
        ]
        for (const [label, tone, hp, get, strong] of goals) {
          const hp0 = hp(steps[0])
          if (!isFinite(hp0) || hp0 <= 0) continue
          if (get(steps[0]) - (steps[0].gain || 0) >= hp0) continue // 빈 장비부터 이미 달성
          const i = steps.findIndex((s) => get(s) >= hp(s))
          if (i >= 0) add(i, label, tone, strong)
        }
      } else {
        // 종합 + 그룹별 정수 컷 돌파 (1컷=상대 한 사이클 버팀)
        const axes: [string, string, (s: UpgradeStep) => number][] = [
          ['평균', 'gold', (s) => s.value],
          ['vs딜러', 'dealer', (s) => s.per[0] ?? 0],
          ['vs탱커', 'armor', (s) => s.per[1] ?? 0],
        ]
        for (const [prefix, tone, get] of axes) {
          let last = Math.floor(get(steps[0]) - (prefix === '평균' ? steps[0].gain : 0))
          steps.forEach((s, i) => {
            const f = Math.floor(get(s))
            if (f > last) { add(i, `${prefix} ${f}컷`, tone); last = f }
          })
        }
      }
      return m
    }
    return {
      eff: { steps: upgradeOrders.efficiency, miles: miles(upgradeOrders.efficiency) },
      greedy: { steps: upgradeOrders.greedy, miles: miles(upgradeOrders.greedy) },
      rank: { steps: upgradeOrders.ranker, miles: miles(upgradeOrders.ranker) },
    }
  }, [upgradeOrders, upoKind])
  const [upoHover, setUpoHover] = useState<number | null>(null)
  const upoMileIdx = useMemo(
    () => new Set(upoAll ? upoAll[upoView].miles.keys() : []),
    [upoAll, upoView],
  )
  // 공격 차트의 원콤 기준선 = 선택 순서의 단계별 상대 HP (풀빌드 모드면 평평한 선)
  const upoHpCurve = useMemo(() => {
    // 딜 기여(딜×생존)는 상대 HP와 단위가 달라 비교 불가 → 화력 모드에서만 원콤선 표시
    if (!upoAll || upoKind !== 'attack' || upoObj !== 'burst') return undefined
    const pts = upoAll[upoView].steps.filter((s) => s.hp != null).map((s) => ({ x: s.cumCoin, y: s.hp as number }))
    return pts.length > 1 ? pts : undefined
  }, [upoAll, upoView, upoKind, upoObj])

  return (
    <div className="app">
      <header className="topbar">
        <h1><img className="logo" src={`${import.meta.env.BASE_URL}icon.png`} alt="" width="26" height="26" />사이퍼즈 킷 시뮬레이터</h1>
        <span className="date">넥슨 주간 통계 · {TIER_LABELS[tier]} 티어 · {metaScrapedAt} 수집</span>
      </header>

      {/* 캐릭터 + 모드 */}
      <section className="panel hero">
        <div className="hero-bar">
          <button
            className={pickerOpen ? 'hero-id open' : 'hero-id'}
            onClick={() => { setQ(''); setPickerOpen(true) }}
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

      </section>

      {/* 캐릭터 선택 모달 (모바일=전체화면 / PC=중앙 다이얼로그) */}
      {pickerOpen && (
        <div className="pick-overlay" onClick={() => setPickerOpen(false)} role="dialog" aria-modal="true">
          <div className="pick-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pick-modal-head">
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
              <button className="pick-close" onClick={() => setPickerOpen(false)} aria-label="닫기">✕</button>
            </div>
            <div className="pick-modal-body">
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
          </div>
        </div>
      )}

      {/* 내 세팅 */}
      <SecHead
        title="내 세팅"
        sub={setting === 'auto'
          ? '대세 빌드 순서대로 자동 진행 — 슬라이더로 게임 시점을 조절하세요'
          : '장비 레벨·아이템과 상대를 직접 조정합니다'}
      />
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
            {build && <span className="src">구매 순서: 랭커 매치 {build.samples.toLocaleString()}판 (Neople API)</span>}
          </div>
        </section>
      )}

      {/* 강화 순서 추천 (자동 모드 · 현재 탭·선택 킷 기준) */}
      {setting === 'auto' && upgradeOrders && (
        <>
          <SecHead
            title="강화 순서 추천"
            sub={`매 구매 시점 코인 대비 ${simView === 'attack' ? '딜' : '생존'} 이득이 가장 큰 순서로 강화 · 상대는 ${upoOpp === 'sync' ? '나와 같은 구매 수' : '풀빌드'} 기준`}
          />
          <section className="panel upo">
            <div className="upo-note">
              <span title={upoNeck
                ? `이 로드맵이 끼는 목걸이: ${upoNeck.name}`
                  + (upoNeck.matched ? '' : `\n주간 통계에 ${simView === 'attack' ? '공목' : '방목'} 착용 표본이 없어 실착용 목걸이로 계산합니다`)
                : undefined}>
                {upoNeck ? `${upoNeck.def ? '방목' : '공목'} 착용 기준` : '착용 기준'}
                {upoNeck && !upoNeck.matched && <em className="upo-warn">＊</em>}
              </span>
              {' · 킷 '}<b>{simView === 'attack' ? kitName(upoKit ?? NONE_KIT) : defKitName(upoKit ?? NONE_KIT)}</b>
              {simView === 'attack' && (
                <span className="seg upo-seg" title={'무엇을 최대화할지\n딜 기여 = 한타 딜 × 버티는 사이클 수 — 죽으면 딜을 못 넣으므로 체력·방어도 기여로 계산 (권장)\n한타 딜 = 순수 화력만 — 생존을 무시해 셔츠(체력)를 끝까지 안 삼'}>
                  <span className="lbl">목표</span>
                  {([['contrib', '딜 기여'], ['burst', '한타 딜']] as const).map(([v, label]) => (
                    <button key={v} className={upoObj === v ? 'on' : ''} onClick={() => setUpoObj(v)}>{label}</button>
                  ))}
                </span>
              )}
              <span className="seg upo-seg" title={'상대 진행도\n풀빌드 = 완성된 상대 기준 — 원콤 시점이 의미 있게 잡힘 (권장)\n나와 동일 = 상대도 나와 같은 구매 수 — 대등한 교전이라 초반부터 원콤이 되어 마일스톤은 거의 사라짐'}>
                <span className="lbl">상대</span>
                {([['full', '풀빌드'], ['sync', '나와 동일']] as const).map(([v, label]) => (
                  <button key={v} className={upoOpp === v ? 'on' : ''} onClick={() => setUpoOpp(v)}>{label}</button>
                ))}
              </span>
              <span className="upo-hint">Y = {simView === 'attack' ? (upoObj === 'contrib' ? '총 딜 기여' : '한타 딜') : '생존 컷'} · X = 누적 코인</span>
            </div>
            {/* 구매 로드맵 — 칩 흐름을 컷 달성 구분선이 페이즈로 나눔.
                세 순서를 같은 셀에 겹쳐 렌더(비활성 숨김) → 전환해도 높이 고정 */}
            <div className="upo-roads">
              {(['eff', 'greedy', 'rank'] as const).map((v) => {
                const { steps, miles: mm } = upoAll?.[v] ?? { steps: [], miles: new Map<number, { label: string; tone: string; strong?: boolean }[]>() }
                const active = upoView === v
                const slots = gearSlotsOf(slug, tier)
                return (
                  <div key={v} className={active ? 'upo-road' : 'upo-road off'}
                    onMouseLeave={active ? () => setUpoHover(null) : undefined}>
                    {!steps.length && <span className="upo-empty">데이터 없음</span>}
                    {steps.map((s, i) => {
                      const miles = mm.get(i)
                      return (
                        <Fragment key={i}>
                          <div className={miles ? 'upo-buy mile' : 'upo-buy'}
                            onMouseEnter={active ? () => setUpoHover(i) : undefined}
                            title={`${i + 1}번째 구매 · ${s.slot} ${s.level}강${s.charLv != null ? ` · Lv.${i > 0 ? steps[i - 1].charLv ?? 0 : 0}→${s.charLv}` : ''} · ${fmt(s.coin)}코인 (누적 ${fmt(s.cumCoin)}) · ${upoVal(s.value, upoKind, 2)} (${upoGain(s.gain, upoKind)})`
                              + (upoKind === 'attack' && upoObj === 'contrib' && s.surv != null
                                ? `\n= 한타 딜 ${fmt(s.per[0] != null ? s.value / s.surv : 0)} × 생존 ${s.surv.toFixed(2)}사이클` : '')
                              + (s.slot === '발(이동)' ? '\n이동속도는 딜·생존 계산 밖 유틸 → 랭커 실구매 타이밍에 고정' : '')}>
                            <em>{i + 1}</em>
                            <img src={itemIcon(slots[s.slot]?.[s.item ?? 0]?.icon)} alt="" loading="lazy" onError={hideOnError} />
                            <span className="t">
                              <b className={UPO_TONE[s.slot] ?? ''}>{slots[s.slot]?.[s.item ?? 0]?.name ?? UPO_SHORT[s.slot] ?? s.slot}</b>
                              <i><u>{UPO_SHORT[s.slot] ?? s.slot} {s.level}강</u>{s.charLv != null && <span className="lv">Lv.{s.charLv}</span>} · {upoVal(s.value, upoKind)}</i>
                            </span>
                          </div>
                          {miles && (
                            <div className={`upo-cut ${miles[0].tone}`}
                              title={upoKind === 'attack'
                                ? '원콤 = 한 사이클(평타+스킬) + 궁 1회의 기대 데미지가 그 그룹 평균 HP 이상 (잡기 제외)\n궁없이 원콤 = 궁을 아껴도 사이클만으로 처치 (최상)'
                                : 'N컷 = 상대의 사이클+궁 N번을 버티는 체력·방어'}>
                              {miles.map((x) => (
                                <b key={x.label} className={x.strong ? `${x.tone} noult` : x.tone}>✓ {x.label}</b>
                              ))}
                              <small>{i + 1}번째 구매 · 누적 {fmt(s.cumCoin)}코인{upoKind === 'attack' && miles.every((x) => !x.strong) ? ' · 궁 포함' : ''}</small>
                            </div>
                          )}
                        </Fragment>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <UpgradeChart kind={upoKind} marks={upoMarks} hpCurve={upoHpCurve} activeTone={upoView} hoverIdx={upoHover} mileIdx={upoMileIdx} curves={[
              { tone: 'eff', steps: upgradeOrders.efficiency },
              { tone: 'greedy', steps: upgradeOrders.greedy },
              { tone: 'rank', steps: upgradeOrders.ranker },
            ]} />
            <div className="upo-legend">
              {([
                ['추천 (효율)', 'eff', upgradeOrders.efficiency],
                ['탐욕', 'greedy', upgradeOrders.greedy],
                ['랭커 실구매', 'rank', upgradeOrders.ranker],
              ] as [string, 'eff' | 'greedy' | 'rank', UpgradeStep[]][]).map(([label, tone, steps]) => (
                <button key={tone} className={`upo-leg ${tone} ${upoView === tone ? 'on' : ''}`} onClick={() => setUpoView(tone)}>
                  {label} <span className="upo-leg-avg">{simView === 'attack' ? (upoObj === 'contrib' ? '평균 기여' : '평균 딜') : '평균 생존'} <b>{steps.length ? upoVal(upoAvg(steps), upoKind) : '–'}</b></span>
                </button>
              ))}
              <span className="upo-leg-note">완성하면 셋 다 같아짐 — 가는 길(같은 코인에서 얼마나 센가)이 순서의 차이 · 클릭하면 위 로드맵이 바뀜 · 신발(이동)은 유틸이라 랭커 실구매 타이밍에 고정</span>
            </div>
          </section>
        </>
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
            footer={
              <div className="gp-row dk">
                <span className="gp-slot">방어킷</span>
                <select
                  className="gp-item"
                  value={kitSig(selectedDefKit)}
                  onChange={(e) => setSelDefKitSig(e.target.value)}
                  title="내 방어킷 — 피격 결과에 반영"
                >
                  {defOptions.map((k) => (
                    <option key={kitSig(k)} value={kitSig(k)}>
                      {k.name === '킷 없음' ? '킷 없음' : `${defKitName(k)} (${kitStat(k)})`}
                    </option>
                  ))}
                </select>
              </div>
            }
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
              <div className="opp-field">
                <p className="opp-note">입장률로 가중한 상대 전체 · 내 구매 수({gearLevelCount(gearEff)})에 맞춘 진행도</p>
                {shares && (
                  <div className="field-bar" title="입장률 가중 · 목걸이/방어킷 착용 분포로 분할">
                    {([
                      ['dealer', shares.dealer, '딜러'],
                      ['armor', shares.tank * shares.armorInTank, '방탱'],
                      ['evade', shares.tank * shares.evadeInTank, '회탱'],
                    ] as const).map(([tone, frac, label]) => (
                      <span key={tone} className={`fb-seg ${tone}`} style={{ flexGrow: Math.max(frac, 0.0001) }} title={`${label} ${Math.round(frac * 100)}%`}>
                        <span className="fb-lbl">{frac >= 0.12 ? `${label} ${Math.round(frac * 100)}%` : `${Math.round(frac * 100)}%`}</span>
                      </span>
                    ))}
                  </div>
                )}
                {fieldProfile && (
                  <>
                    <div className="opp-stats">
                      <div>
                        <span>평균 방어</span>
                        <b>{Math.round(fieldProfile.reduction * 100)}%</b>
                        <em title={`내 관통 ${Math.round(fieldProfile.pen * 100)}% 적용 후 실효 방어`}>관통 후 {Math.round(fieldProfile.reduction * (1 - fieldProfile.pen) * 100)}%</em>
                      </div>
                      <div><span>평균 회피</span><b>{fmt(fieldProfile.evade)}</b><em>내 치명과 대결</em></div>
                      <div><span>평균 HP</span><b>{fmt(fieldProfile.hp)}</b><em>처치까지 기준</em></div>
                    </div>
                    <div className="opp-roster">
                      <span className="lbl"><small>{fieldProfile.roster.length}명 · 입장률 가중 비중</small></span>
                      <div className="roster">
                        {fieldProfile.roster.map((t) => (
                          <span key={t.slug} className="rst" title={`${t.name} · 필드의 ${(t.pct * 100).toFixed(2)}%`}>
                            <img src={iconUrl(t.slug)} alt="" loading="lazy" onError={hideOnError} />
                            <em className="nm">{t.name}</em>
                            <em className="pc">{t.pct * 100 < 0.05 ? '<0.1' : (t.pct * 100).toFixed(1)}%</em>
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
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
                      <option key={i} value={i}>{k.name === '킷 없음' ? '킷 없음' : `${defKitName(k)} (${kitStat(k)})`}</option>
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

      {/* 공격/방어 탭 */}
      <div className="sim-tabs">
        <button className={simView === 'attack' ? 'on atk' : ''} onClick={() => setSimView('attack')}>
          공격
        </button>
        <button className={simView === 'defense' ? 'on def' : ''} onClick={() => setSimView('defense')}>
          방어
        </button>
      </div>

      {simView === 'attack' && (
      <>
      {/* 공격킷 */}
      <SecHead title="공격킷 추천" sub={fieldMode ? '상대 유형별로 딜이 가장 잘 나오는 킷 — 클릭해 상세 비교' : '선택한 상대에게 딜이 가장 잘 나오는 킷'} />
      <section className="panel kits">
        <div className="kits-head">
          {fieldMode && (
            <span className="kh-sort">
              <span className="lbl">정렬</span>
              {([['all', '종합'], ['dealer', '딜러'], ['tank', '탱커'], ['armor', '방탱'], ['evade', '회탱'], ['usage', '착용률']] as const).map(([v, label]) => (
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
            실제 착용 킷 후보 · ★ 종합 최적
            {fieldMode && <> · <em className="t-dealer">딜러</em> <em className="t-armor">방탱</em> <em className="t-evade">회탱</em> (●=1위)</>}
          </span>
        </div>
        <div className="kit-chips">
          {sortedKits.map(({ kit, per }) => {
            const sig = kitSig(kit)
            const tip = fieldMode
              ? `${kitName(kit)} · ${kitStat(kit)}\n\n상대별 한 사이클+궁 기대 데미지 (높을수록 좋음)\n${per.map((v, i) => `· ${FIELD_LABELS[i]}: ${fmt(v)}`).join('\n')}`
              : `${kitName(kit)} · ${kitStat(kit)}\n\n한 사이클+궁 기대 데미지 ${fmt(per[0])}`
            return (
              <button key={sig} className={sig === kitSig(selectedKit) ? 'chip on' : 'chip'} onClick={() => setSelKitSig(sig)} title={tip}>
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
                {usageBadge(atkUsage, kit)}
              </button>
            )
          })}
        </div>
      </section>

      {/* 필드 구성 스택 바 — 입장률·목걸이·방어킷 분포로 분할 (수동 모드에선 상대 세팅 패널에 표시) */}
      {fieldMode && shares && setting === 'auto' && (
        <div className="field-bar" title="입장률 가중 · 목걸이/방어킷 착용 분포로 분할">
          {([
            ['dealer', shares.dealer, '딜러'],
            ['armor', shares.tank * shares.armorInTank, '방탱'],
            ['evade', shares.tank * shares.evadeInTank, '회탱'],
          ] as const).map(([tone, frac, label]) => (
            <span key={tone} className={`fb-seg ${tone}`} style={{ flexGrow: Math.max(frac, 0.0001) }} title={`${label} ${Math.round(frac * 100)}%`}>
              <span className="fb-lbl">{frac >= 0.12 ? `${label} ${Math.round(frac * 100)}%` : `${Math.round(frac * 100)}%`}</span>
            </span>
          ))}
        </div>
      )}

      {/* 결과 · 공격 */}
      <SecHead
        title="예상 전투 결과"
        sub={fieldMode
          ? '내가 때릴 때 — 상대 유형별 한타 딜과 처치 컷 · 상대는 방어킷 복용 가정'
          : '선택한 상대와 1:1 — 스킬별 데미지와 처치 컷'}
      />
      <section className={fieldMode ? 'results five' : 'results'}>
        {sims.map((s, i) => (
          <ResultPanel key={i} title={s.title} sub={s.sub} tone={s.tone} sim={s.sim} noKit={s.noKit} stat={s.stat} />
        ))}
      </section>
      </>
      )}

      {simView === 'defense' && (
      <>
      {/* 방어킷 — 받는 피해 기준 생존 사이클 (필드 모드 전용) */}
      {fieldMode && defRank && (
        <>
        <SecHead title="방어킷 추천" sub="상대 공격을 오래 버티게 해주는 킷 — 클릭해 내 방어킷 선택 (아래 피격 결과에 반영)" />
        <section className="panel kits def">
          <div className="kits-head">
            <span className="kh-legend">
              숫자 = 상대의 <b>사이클+궁을 버티는 횟수</b> (높을수록 오래 생존) · ★ 종합 최적 · <em className="t-dealer">딜러</em> <em className="t-tank">탱커</em> (●=1위)
            </span>
          </div>
          <div className="kit-chips">
            {defRank.map(({ kit, per, total }) => {
              const sig = kitSig(kit)
              const none = kit.name === '킷 없음'
              const gain = !none && defNoneTotal > 0 && Number.isFinite(total) ? Math.round((total / defNoneTotal - 1) * 100) : 0
              const surv = per.map((v, i) => `· ${DEF_FIELD_LABELS[i]} 공격을 ${Number.isFinite(v) ? v.toFixed(1) : '∞'}번 버팀`).join('\n')
              const head = `${defKitName(kit)} · ${kitStat(kit)}`
              const explain = '각 상대가 한 사이클+궁을 온전히 맞혀 나를 처치하는 데 필요한 횟수\n(예: 1.0 = 딱 한 번에 죽음, 2.0 = 두 번 버팀 · 높을수록 튼튼)'
              const tip = none
                ? `${head}\n\n${explain}\n${surv}`
                : `${head}\n\n${explain}\n${surv}\n\n킷 없음 대비 생존력 ${gain >= 0 ? '+' : ''}${gain}%`
              return (
                <button key={sig} className={sig === kitSig(selectedDefKit) ? 'chip on' : 'chip'} onClick={() => setSelDefKitSig(sig)} title={tip}>
                  {sig === defBestSig && <i>★</i>}
                  {kit.icon && <img src={itemIcon(kit.icon)} alt="" loading="lazy" onError={hideOnError} />}
                  <b>{defKitName(kit)}</b>
                  <span className="tri">
                    {per.map((v, i) => (
                      <span key={i} className={`tnum ${DEF_TONES[i]}`}>
                        {defBestPerTarget[i] === sig && <em>●</em>}{Number.isFinite(v) ? v.toFixed(1) : '∞'}
                      </span>
                    ))}
                  </span>
                  {usageBadge(defUsage, kit)}
                </button>
              )
            })}
          </div>
        </section>
        </>
      )}

      {/* 결과 · 방어 (피격) */}
      <SecHead
        title="예상 피격 결과"
        sub={fieldMode
          ? '상대가 나를 때릴 때 — 선택한 방어킷 기준 받는 피해와 버티는 컷 · 상대는 공격킷 복용 가정'
          : '상대가 나를 때릴 때 — 선택한 방어킷 기준 1:1 받는 피해'}
      />
      <section className={defPanels.length > 1 ? 'results five' : 'results'}>
        {defPanels.map((p, i) => (
          <DefensePanel key={i} {...p} />
        ))}
      </section>
      </>
      )}

      {/* 계산 과정: 통계 → 결과가 나오기까지 */}
      <section className="panel method">
        <button className="m-head" onClick={() => setMethodOpen((o) => !o)}>
          <span>이 숫자는 어떻게 나왔나요?</span>
          <small>입장률 → 착용 통계 → 구매 순서 → 데미지 공식, 4단계</small>
          <i>{methodOpen ? '▴' : '▾'}</i>
        </button>
        {methodOpen && (
          <>
            <div className="m-steps">
              <div className="m-step">
                <em>1</em>
                <b>누구를 만나나</b>
                <p>이번 주 <u>{TIER_LABELS[tier]} 티어</u> 입장 통계로 상대가 나올 확률을 정합니다. 각 캐릭터는 <u>목걸이 착용 분포</u>대로 딜러/탱커에 비율로 나눠 반영하므로, 한 캐릭터가 양쪽에 걸칠 수 있습니다.</p>
                {shares && (
                  <p className="num" title="비율 분할이라 한 캐릭터가 딜러·탱커에 동시에 걸칠 수 있어, 명수는 가중치>0인 고유 캐릭터 수입니다">
                    딜러 {Math.round(shares.dealer * 100)}% ({shares.nDealers}명) · 탱커 {Math.round(shares.tank * 100)}% ({shares.nTanks}명)<br />
                    탱커 안에서 방어킷 착용 비율대로<br />방탱 {Math.round(shares.armorInTank * 100)}% : 회탱 {Math.round(shares.evadeInTank * 100)}%
                  </p>
                )}
              </div>
              <div className="m-step">
                <em>2</em>
                <b>상대는 뭘 입었나</b>
                <p>부위마다 이번 주 <u>{TIER_LABELS[tier]} 티어</u>에서 실제 착용된 비율 그대로 섞은 <u>기대 세팅</u>을 입은 것으로 봅니다. 1위 아이템만 고르는 게 아니라 착용 분포 전체를 반영합니다. 장비는 착용률로 가중한 기대 세팅이지만, <u>방어킷·공격킷</u>은 착용 분포대로 나눠 조합마다 따로 계산합니다(공격 시 상대 방어킷, 피격 시 상대 공격킷).</p>
                <p className="num">
                  예) {char.name} 손 슬롯:<br />
                  {(() => {
                    const cands = gearSlotsOf(slug, tier)['손(공격)'] ?? []
                    const total = cands.reduce((s, c) => s + (c.pct || 0), 0) || 1
                    return cands.slice(0, 2).map((c) => `${c.name} ${Math.round((c.pct / total) * 100)}%`).join(' + ') + (cands.length > 2 ? ' + …' : '')
                  })()}<br />
                  비율대로 가중 평균 (표본 {myView.samples.toLocaleString()}판)
                </p>
              </div>
              <div className="m-step">
                <em>3</em>
                <b>게임 시점 맞추기</b>
                <p>랭커 매치 {build ? build.samples.toLocaleString() : '—'}판의 실제 구매 로그로 "몇 번째 구매에 뭘 사는지"를 집계해, 나와 상대 모두 같은 시점까지 장비를 채웁니다.</p>
                <p className="num">지금 보는 시점: {setting === 'auto' ? `${stageEff} / ${maxStage}번째 구매` : `수동 세팅 (${gearLevelCount(gearEff)}구매 상당)`}</p>
              </div>
              <div className="m-step">
                <em>4</em>
                <b>데미지 계산</b>
                <p>커뮤니티 검증 데미지 공식으로 상대 한 명 한 명 스킬 데미지를 계산한 뒤, 1번의 확률로 가중 평균한 값이 각 패널의 숫자입니다.</p>
                <p className="num formula" title={FORMULA_TIP}>데미지 공식 자세히 ⓘ</p>
              </div>
            </div>
            <p className="m-note">
              단순화한 부분: 부위별 착용률 상위 4개까지만 반영(그 아래 꼬리는 절사) · 부위 방어%의 평균은 선형 근사 · 각 캐릭터는 목걸이 착용 분포대로 딜러/탱커로 비율 분할 · 구매 순서는 랭커 데이터로 전 티어 공용 · 방어·회피 변환은 근사치 · 킷은 양쪽 모두 복용한 상태의 맞교환 가정
            </p>
          </>
        )}
      </section>

      {/* 출처 */}
      <footer className="foot">
        <p className="foot-src">
          <b>{char.name}</b>의 스킬 계수·기본 스탯은 <b>공식 홈페이지</b>, 부위별 착용률·입장률은{' '}
          <b>넥슨 주간 통계</b>({TIER_LABELS[tier]} 티어 · {metaScrapedAt} · 표본 {myView.samples.toLocaleString()}판),{' '}
          아이템 구매 순서는 <b>Neople 랭커 매치 {build ? build.samples.toLocaleString() : '—'}판</b>에서 가져왔습니다.
        </p>
        <p className="foot-meta">
          <span className="foot-formula" title={FORMULA_TIP}>계산식·규칙 ⓘ</span>
          <span> · 방어·회피 변환은 근사, 킷 간 비교용 · 비공식 팬 도구, 인게임 실측과 다를 수 있음</span>
        </p>
      </footer>
    </div>
  )
}
