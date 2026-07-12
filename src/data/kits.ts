import type { AttackKit } from '../types'

// 사이퍼즈 공격킷 = 소모품 5분류(회복/가속/공격/방어/특수) 중 '공격킷' 카테고리.
// 크게 파이크(공격력) · 이펙트(치명) · 이펙션(방어관통) 계열로 나뉜다.
// 아래 수치는 나무위키 '사이퍼즈/소모품' 문서 기준 실제 아이템 값이다(패치에 따라 변동 가능).
// 참고: 치명 스탯 자체가 %(회피와의 차이가 치명확률)라 "치명 +42%"는 치명 스탯 +42로 반영한다.
export const kits: AttackKit[] = [
  {
    id: 'none',
    name: '킷 없음',
    desc: '공격킷 미장착',
    buffs: [],
  },
  {
    id: 'pike',
    name: '파이크',
    desc: '순수 공격력 +92',
    buffs: [{ stat: 'attack', flat: 92 }],
  },
  {
    id: 'garak',
    name: '가락엿 / 호미',
    desc: '공격력 +89',
    buffs: [{ stat: 'attack', flat: 89 }],
  },
  {
    id: 'meltz-avenger',
    name: '멜츠 어벤저',
    desc: '대인 공격력 +93',
    buffs: [{ stat: 'attack', flat: 93 }],
  },
  {
    id: 'effect',
    name: '이펙트',
    desc: '순수 치명 +42',
    buffs: [{ stat: 'crit', flat: 42 }],
  },
  {
    id: 'nelson-criminS',
    name: '넬스 크리민S',
    desc: '공격 +24, 치명 +29 (하이브리드)',
    buffs: [
      { stat: 'attack', flat: 24 },
      { stat: 'crit', flat: 29 },
    ],
  },
  {
    id: 'pikefection',
    name: '파펙션 (파이크 이펙션)',
    desc: '공격 +40, 방어관통 10%',
    buffs: [{ stat: 'attack', flat: 40 }],
    penetration: 0.1,
  },
  {
    id: 'critfection',
    name: '치펙션 (이펙트 이펙션)',
    desc: '치명 +18, 방어관통 10%',
    buffs: [{ stat: 'crit', flat: 18 }],
    penetration: 0.1,
  },
]
