# 사이퍼즈 킷 시뮬레이터 — 설계·게임시스템·API 문서

> 이 문서는 프로젝트를 나중에 재개할 때를 위한 레퍼런스다. **게임 시스템 이해, 데이터 소스(API), 구현 논리와 그 이유**를 담는다.
> 데이터/공식은 넥슨이 공식 수식을 전부 공개하지 않아 일부는 커뮤니티 역산 + 인게임 스크린샷으로 검증한 값이다.

---

## 1. 이 도구가 하는 일

**"내가 이 캐릭터를 할 때, 현재 메타(입장률·착용 통계)에서 어떤 공격킷/방어킷이 가장 합리적인가"** 를 알려주는 시뮬레이터.

- 세팅 시점엔 상대를 모르므로, **입장률로 가중한 통계적 상대 필드**에 대한 기대 데미지로 판단.
- 상대를 **딜러(공목)/탱커(방목)** 로 나눠 따로 계산 (킷 선택이 상대 유형에 크게 좌우되므로).
- 나·상대가 **빌드 순서대로 함께 성장**한다는 전제로 게임 시점별(구매 수) progression 제공.

---

## 2. 게임 시스템

### 2.1 데미지 공식 (검증됨 — 인게임 SKILL DETAIL = 홈페이지 = 아래)

```
스킬 데미지 = (고정뎀 + 퍼센트계수 × 공격력)
            × (1 + 스킬공격력 총합)
            × (대인 / 공성 / 몬스터 계수)      ← PvP는 대인
            × (1.3 + 치명타 피해량)            ← 치명타 성공 시. 회피 성공 시 ×0.4
            × (1 − 방어 × (1 − 방어관통))
            × 상황(다운 등)
            → 최종 소수점 내림
```

- **퍼센트뎀 = 퍼센트계수 × 공격력** (공격력에 비례).
- **고정뎀 = 스킬 고유값** (공격력 무관). 단, 스킬공격력이 고댐·퍼댐 **둘 다** 곱한다.
- **치명타 ↔ 회피**: 단리(선형) 대결. `diff = 내 치명 − 상대 회피`. 양수면 그만큼(%) 치명타(×(1.3+치명피해량)), 음수면 그만큼(%) 회피(×0.4, 부분감산). 치명/회피 스탯은 % 스케일(예: 치명 55 = 55%).
- **방어**: 곱연산 스택(아이템 레벨 간에도). 총 감소율 = `1 − ∏(1 − 개별 방어%)`.
- **방어관통**: 상대 방어를 곱연산 감소 (`방어 × (1−관통)`).

### 2.2 스킬공격력 & 스킬링 (핵심 — 오해하기 쉬움)

- **스킬공격력** = 기본 100%(×1.0)에서 시작해 **특성 + 코스튬 + 스킬링(아이템)** 이 **합연산**으로 더해진 배수. 예) 100% + 3%(특성) + 5.25%(코스튬) + 100%(링) = 208.25% → ×2.08.
- **스킬링 = 장신구 아이템**이다 (장갑·셔츠처럼 하나의 부위, 장신구1~4). "특성/코스튬"이 아니다 — 이걸 헷갈리지 말 것.
- 메타 장신구는 전부 **스킬별 추가공격력**("절명참철도(E) 추가공격력 +90%" 식)이다. 특정 스킬에만 적용. → 코드에선 `skillBoost[스킬명]`로 저장하고 그 스킬 데미지에 `×(1+boost)`.
- 메타엔 "전체 스킬공격력을 올리는 일반 링"은 사실상 없음(확인함). 특성·코스튬(~8%)만 통계 데이터 밖 → 무시(미미).

### 2.3 스킬

- 조작키별: **좌클릭=평타**, 우클릭/Space/Shift+클릭/양쪽클릭/휠 = 일반 스킬, **E=궁(쿨 40초+)**, **F=잡기**.
- **잡기 = 조작키가 F인 스킬**로 판별한다. ⚠️ "잡기 판정(grab judgment)"이 있다고 잡기가 아니다 — 궁(절명참철도 등)도 잡기 판정이 있음. 오직 F키 전용 스킬만 잡기.
- 잡기는 특수기라 **일반 사이클에서 제외**. 별도 "사이클+잡기" 지표로만.
- **1궁/2궁 모드**: 캐릭터마다 궁극기 2택. 한 판에 하나만. 스킬 일부가 모드별로 바뀜(스킬 페이지 `table.skill_lst`의 1st열/2nd열). 선택 모드의 스킬만 계산.
- **아머 계수(대인/공성/몬스터)**, **다운 계수** 존재. PvP는 대인.
- 전투 리듬 = **한 사이클 돌리고 심리전 리셋** → 연속 DPS 개념 성립 안 함. 그래서 지표는 "사이클/사이클+잡기/사이클+궁" 단위.

### 2.4 스탯 & 역할

- 기본 스탯: 공격 / 치명 / 체력 / 회피 / 방어 / 이동 (공식 홈페이지 표기값).
- **역할 = 목걸이로 판별**: 공격 목걸이(공목)=딜러, 방어 목걸이(방목)=탱커. → 목 슬롯 아이템의 방어% 유무로 분류.

### 2.5 아이템 & 레벨

- 슬롯: 손(공격)/머리(치명)/가슴(체력)/허리(회피)/다리(방어)/발(이동)/목/장신구1~4.
- **각 슬롯은 정해진 횟수로 레벨 구매**(레벨업). 손 3레벨, 다리 2레벨, 장신구 4레벨 등 아이템마다 다름. 레벨당 **코인 비용·증가치가 다르다**.
- 예) 손(메이헨): [1렙]550코인 공격+83 / [2렙]1450 +83 / [3렙]1600 +83 = 공격 +249(합연산).
- 예) 다리(펄션): [1렙]650 방어+19.5% / [2렙]850 +19.5% = 방어 35.2%(**곱연산**: 1-(1-.195)²).
- **우선 구매 특전**: **장갑(손) 3레벨을 (러시로) 찍으면 방어관통 +3%**, **셔츠(가슴) 3레벨 찍으면 체력 +5%**. 딜러는 장갑, 탱커는 셔츠를 먼저 감. **적용 시점 = 3레벨을 실제 구매하는 순간**(1·2레벨까진 미적용).

### 2.6 킷 (소모품)

- 5분류(회복/가속/공격/방어/특수), 각 1개. **전 구간 착용**(사망 시 재구매, 스테이지 무관).
- 공격킷: **파이크**(공격)/**이펙트**(치명)/**이펙션**(방어관통, 파이크이펙션·이펙트이펙션)/**넬스크리민**(공격+치명 하이브리드).
- 방어킷: 타즈(방어)/플래쉬(회피)/스테민(체력).

---

## 3. 데이터 소스 & API

### 3.1 넥슨 공식 홈페이지 (cyphers.nexon.com) — 키 불필요

| 용도 | 엔드포인트 | 비고 |
|---|---|---|
| 캐릭터 기본 능력치 | `/game/character/info/{slug}` | `div.s1_21 > p > em` (공격/치명/체력/회피/방어/이동) |
| 스킬 계수 | `/game/character/skill/{slug}` | `div.skill_box`: 이름·쿨타임·조작키·대인/공성/몬스터·`고정+계수×공격력`. `table.skill_lst`로 1궁/2궁 판별 |
| 로스터/아이콘 | 아무 캐릭터 페이지 | `li[id^="slt_{slug}"]`, 아이콘 `resource.cyphers.co.kr/ui/img/character/ico_23px_{N}.jpg` (N은 로스터 img src에서, 결번 있음) |

### 3.2 넥슨 통계 엔드포인트 — 키 불필요 (XHR JSON)

| 용도 | 엔드포인트 | 반환 |
|---|---|---|
| 입장률(pick rate) | `/statistic/rank/entrance/1/0` | `rankList:[{chNameKr(타이틀+이름), chType, value}]`. value/총합 = 확률 |
| 슬롯별 착용 분포 | `/statistic/rank/item/{numId}/1/0/{SLOT}` | 슬롯 코드: HAND/HEAD/CHEST/WAIST/LEG/FOOT/NECK/ITEM_ATTACK/ITEM_DEFENSE/ITEM_MOVE/ITEM_SPECIAL/ITEM_RECOVERY |
| 슬롯 top 아이템 | `/statistic/rank/item/top/{numId}/0` | 슬롯별 최다 아이템 + `equipEffect`(스탯) + `tooltipMore`(레벨별) |
| 승률/밴율 순위 | `/statistic/rank/win/1/0` 등 | |

- `numId`는 통계용 캐릭터 id(0-index 아님, 결번 있음). **아이템 응답의 `itemInfo.character`(이름)로 slug 매핑**한다.
- `itemInfo.equipEffect` = 풀레벨 스탯. `itemInfo.tooltipMore` = `[N레벨]: 비용 X coin / 스탯:+Y` 레벨별 상세.

### 3.3 Neople 공식 API (api.neople.co.kr/cy) — **API 키 필요** (무료, `.env`의 `NEOPLE_API_KEY`)

- **절대 클라이언트/번들에 넣지 말 것** (VITE_ 접두사 금지). 빌드타임 스크립트에서만 사용.

#### 3.3.1 엔드포인트 전체 목록 (2026-07-13 라이브 실측)

| 엔드포인트 | 용도 | 반환 (실측) | 프로젝트 사용 |
|---|---|---|---|
| `GET /characters` | 캐릭터 목록 | `rows[84]: {characterId(해시32), characterName}` | ❌ (넥슨 numId 사용중) |
| `GET /ranking/ratingpoint` | 전체 랭킹 | `rows[]: {rank, playerId, nickname, grade, ratingPoint, clanName, represent{characterId,characterName}}` | ✅ 랭커 수집 |
| `GET /ranking/characters/{characterId}/{type}` | 캐릭터별 랭킹 | type=`winCount·winRate·killCount·assistCount·exp`. `{rank, playerId, nickname, winCount, loseCount, winRate, …}` | ❌ |
| `GET /ranking/tsj/{melee\|ranged}` | 투신전(1:1) 랭킹 | `{rank, playerId, ratingPoint, winCount, loseCount, winningStreak}` | ❌ |
| `GET /players?nickname=&wordType=&limit=` | 닉네임 검색 | `{playerId, nickname, grade, clanName}` | ❌ |
| `GET /players/{playerId}` | 플레이어 프로필 | `{tierName(ACE…), ratingPoint, maxRatingPoint, represent, tierTest, records[{gameTypeId, winCount, loseCount, stopCount}]}` | ❌ |
| `GET /players/{id}/matches` | 매치 목록 | `matches:{date,gameTypeId,next,rows[{matchId,playTime,result,characterName,killCount,…}]}` | ✅ 매치 id 수집 |
| `GET /matches/{matchId}` | 매치 상세 | `{date, gameTypeId, map{mapId,name}, teams[{result,players[]}], players[]}` (아래 상세) | ⚠️ itemPurchase만 |
| `GET /battleitems?itemName=&wordType=&characterId=&slotCode=&rarityCode=&seasonCode=&limit=` | 아이템 검색 (itemName 필수) | `rows[]: {itemId, itemName, characterId, characterName, slotCode, slotName, rarityCode, seasonCode}` | ❌ |
| `GET /battleitems/{itemId}` | 아이템 상세 | `{…, explain, explainDetail(레벨별 코인·스탯·쿨타임·지속시간)}` | ❌ |
| `GET /multi/battleitems?itemIds=` | 아이템 벌크 상세 (콤마구분) | `rows[]: 위와 동일 (explainDetail 포함)` | ❌ |

#### 3.3.2 매치 상세 `players[]` 전체 필드

현재 `itemPurchase`(빌드순서)와 `items`(슬롯매핑)만 사용. 나머지는 미사용:

```
playInfo: {
  characterId, characterName, level, playTime, random, partyUserCount, partyId,
  killCount, deathCount, assistCount,          // KDA
  attackPoint,                                 // 가한 피해 포인트
  damagePoint,                                 // ⭐ 받은 총 피해 — 실측 검증용
  battlePoint, sightPoint, towerAttackPoint,   // 전투·시야·공성
  backAttackCount, comboCount, spellCount,     // 백어택·콤보·주문
  healAmount,                                  // 힐량
  sentinelKillCount, demolisherKillCount,       // 오브젝트
  trooperKillCount, guardianKillCount, guardTowerKillCount,
  getCoin, spendCoin, spendConsumablesCoin,     // 코인 경제 (킷 소비)
  responseTime, minLifeTime, maxLifeTime,      // 생존시간
  multiKillCount: {double, triple, quadruple, genocide},
  aceInfo
}
items[]: {itemId, itemName, slotCode, slotName, rarityCode, rarityName, equipSlotCode, equipSlotName, upgrade}
itemPurchase[]: itemId[] (산 순서, 반복=레벨업)
```

#### 3.3.3 슬롯코드 전체 매핑 (매치 items 실측 확정)

| 장비 | 킷(소모품) | 장신구 |
|---|---|---|
| `101` 손(공격) | `301` 회복킷 | `201` 장신구ALL |
| `102` 머리(치명) | `302` 가속킷 | `202` 장신구1 |
| `103` 가슴(체력) | `303` 공격킷 | `203` 장신구2 |
| `104` 허리(회피) | `304` 방어킷 | `204` 장신구3 |
| `105` 다리(방어) | `305` 특수킷 | `205` 장신구4 |
| `106` 발(이동) | | |
| `107` 목 | | 희귀도: `101`커먼 `102`언커먼 `103`레어 `104`유니크 |

#### 3.3.4 한계

- **`/characters`는 id·이름만 반환** — 커뮤니티 타입의 `CypherDetail{ability, skill}`은 실제 미구현. 스킬 계수·기본 스탯은 넥슨 홈페이지 스크래핑이 유일.
- **`/battleitems` 검색은 itemName 필수** — 전체 열거 불가. 매치 하베스트로 itemId 수집 후 상세/멀티 해석.
- **캐릭터별 픽률/승률 메타는 Neople API에 없음** — 넥슨 `/statistic/rank/entrance`가 유일.
- Neople `itemId` ≠ 넥슨 `itemNo` — 교차 매핑은 이름 기준.

### 3.4 히트맵/전적 백엔드 (record-cyphers.neople.co.kr) — **비계약 부가 소스** (2026-07-13 발견)

넥슨 홈페이지 전적 상세의 "히트맵" 기능이 호출하는 **별도 도메인의 내부 백엔드**. 키 불필요, JSON. `api.neople.co.kr`(문서화된 계약 API)와 달리 **문서·레이트리밋·안정성 보장이 없음** → 예고 없이 깨질 수 있는 부가 소스로만 취급할 것.

| 엔드포인트 | 반환 | 계약 API에도 있나 |
|---|---|---|
| `GET /api/maps` | 맵 6종 `{mapId, name}` (101리버포드 102메트로 103브리스톨 104스프링 105그랑플람 106리버포드앳던) | — |
| `GET /api/characters` | 84명 `{characterId, characterName}` | ✅ (`/cy/characters`) |
| `GET /api/players?nickname=` | 닉네임 검색 `{playerId, nickname, represent, grade}` | ✅ |
| `GET /api/players/{id}` | 프로필 (티어·RP 등) | ✅ |
| `GET /api/players/{id}/matches` | 매치 목록 (startDate/endDate 필수, 없으면 `CY001 SEARCH_TIME_ERROR`) | ✅ |
| `GET /api/matches/{id}` | 매치 상세 — **`api.neople.co.kr`와 완전 동일 구조** (playInfo·items·itemPurchase 전부) | ✅ |
| **`GET /api/matches/{id}/analytics/heatmap`** | **킬/데스 좌표** `rows[]: {x, y, count}` | ❌ **여기서만** |
| **`GET /api/players/{id}/analytics/heatmap`** | 개인 킬/데스 좌표 (이쪽은 날짜 집계가 유효) | ❌ **여기서만** |

**계약 API로 못 얻는 유일한 것 = 히트맵 좌표.** 나머지는 전부 계약 API에도 있으므로 그쪽을 우선 사용(공식 창구).

**히트맵 쿼리 파라미터:**
```
mapId=106                 // 맵. 매치 상세의 map.mapId 사용
pointId=kill              // kill(가한 처치) | die(사망). ⚠️ death/damage 등은 null. UI "데스"=die
characterId=              // 비우면 전체, 캐릭터 해시 = 해당 캐릭터만
killTargetTypeCode=       // 비우면 전체. 101플레이어 102플레이어(AI) 103소환물 201HQ 202타워 203수호타워 301수호자 302센티넬 303철거반 304트루퍼
startDate=YYYY-MM-DD HH:mm&endDate=...  // ⚠️ 매치 스코프에선 무시됨(그 매치 실제 이벤트). 개인 스코프에서만 유효
gameTypeId=rating         // rating | normal
abs=false                // true/false 둘 다 좌표 반환(스케일 차이 미미)
```

- **매치 스코프 = 그 판의 실제 킬/데스 이벤트 좌표** (날짜 무시). 검증: 30일↔1시간 요청이 동일(450좌표/537킬), 클레어 필터=78좌표/85킬 = 클레어 실제 전적(킬3+센티넬18+철거반60+트루퍼1≈82) 일치.
- **좌표계**: 맵 이미지 `record-cyphers.neople.co.kr/images/map/{mapId}.png` 픽셀 기준. `count`=그 지점 이벤트 수.
- **없는 것**: `/analytics/{timeline,graph,coin,damage,gold}` 전부 404. 좌표 외 파생 데이터·타임스탬프 없음.
- **용도**: 데미지/킷 모델과는 무관(위치 데이터). 캐릭터 킬/데스 핫스팟(라인전형·로밍형·오브젝트형) 같은 별개 확장에만.

---

## 4. 데이터 파이프라인 (scripts/ → src/data/*.json)

| 스크립트 | 키 | 산출물 | 내용 |
|---|---|---|---|
| `scrape-skills.mjs` | ❌ | `skills.json` | 84명 스킬(이름/쿨타임/조작키/grab(F)/대인계수/hits(고정,퍼센트,다운)/modes(1st,2nd)) |
| `scrape-meta.mjs` | ❌ | `meta.json` | 84명: 입장률·역할·풀빌드 스탯·**슬롯별 스탯(slots)**·**레벨별 스탯(slotLevels)**·공격킷/방어킷 착용분포 |
| `scrape-buildorder.mjs` | ✅ Neople | `buildorder.json` | 랭커 매치 itemPurchase 집계 → 캐릭터별 **(슬롯,레벨) 평균 구매 순서**. 800랭커≈5천매치, 82/84 커버 |
| `scrape-characters.mjs` | ❌ | `characters.json` | 84명 기본 능력치(공격/치명/체력/회피/방어/이동) — `/game/character/info/{slug}` 파싱 |
| `icons.ts` | — | (고정 매핑) | slug→아이콘 번호 |

실행: `node scripts/scrape-skills.mjs`, `node scripts/scrape-meta.mjs`, `node --env-file=.env scripts/scrape-buildorder.mjs`.

---

## 5. 엔진/모델 (src/recommend.ts, src/engine.ts)

- **partialBuild(slug, stage)**: 빌드순서(buildorder)의 첫 `stage`개 구매를 `meta.slotLevels`로 누적. 공격/치명/치명피해/관통/회피/체력 가산, 방어는 곱연산, skillBoost 가산. 우선구매특전(손3레벨→관통+3%, 가슴3레벨→체력+5%)은 해당 레벨 구매 완료 시점부터.
- **attackerAtStage / defenderAtStage / hpAtStage**: 부분빌드 + 킷(전구간). 나·상대 같은 스테이지.
- **roleFieldTarget(role, stage, excludeSlug)**: 그 역할(딜러/탱커) 상대들을 입장률 가중, 각자 같은 스테이지의 부분빌드 방어. → 각 상대별 계산 후 가중평균(가상 평균캐릭터 아님).
- **simulate**: 선택 모드 스킬별 데미지 → 사이클(평타+스킬)/잡기/궁(최대) 합계. cyclePlusUlt가 킷 비교 지표.
- **킷 필터**: 스탯이 완전히 열등한(dominated) 킷 제외(예: 공격+80은 공격+92에 밀림). `kitSig`로 스킨 중복 제거.

---

## 6. 주요 설계 결정과 이유

- **입장률 가중 필드 + 캐릭터별 계산 후 평균** (가상 평균캐릭 X): 각 상대가 자기 템포로 크는 걸 살리려고.
- **딜러/탱커 분리**: 킷 최적해가 상대 유형에 크게 갈리므로(관통킷은 탱커에 유리 등).
- **구매 단위 progression + 아이템 레벨**: "슬롯=풀스탯" 근사는 초반을 과대평가(장갑 1렙인데 +249로 침) → itemPurchase의 실제 레벨업 순서 + 툴팁 레벨별 스탯으로 교체.
- **잡기=F키**: 잡기판정으로 하면 궁까지 오분류 → 조작키 F로 정확히.
- **스킬 데미지가 주(主), TTK는 "사이클" 단위**: 연속 딜이 비현실적이라 사용자가 요청.
- **HUD 콘솔 다크 테마 + 수치 모노스페이스**: 게임 analytics 느낌. 딜러=코랄/탱커=틸로 매치업 즉시 인지.

---

## 7. 알려진 한계 / 근사

- **방어 스탯 → 감소% 변환**: 표기 방어값을 %로 근사(곱연산). 근/원거리 방어 구분은 게임 내 비공개라 미반영 → **절대값보다 킷 간 상대 비교를 신뢰**할 것.
- **일반 스킬공격력(특성/코스튬 ~8%)**: 통계 데이터 밖이라 미반영(미미). 필요시 조절 슬라이더 추가.
- **코인/성장 속도**: 유리한 측이 빠르지만 **대등 전제**로 단순화.
- **표본 얇은 캐릭**(시바포·J 등 2명): 빌드순서 데이터 없음.
- 스킬링/베리드 이외 스킬레벨 시스템은 별도 없음(스킬링=장신구로 귀결).

---

## 8. 갱신 / 배포 (예정)

- **반수동 갱신**: GitHub Actions cron으로 세 스크래퍼 실행 → JSON 커밋 → 재배포. Neople 키는 **GitHub Secret**(`NEOPLE_API_KEY`).
- **배포**: GitHub Pages (`vite.config.ts`의 base = 저장소명). `.github/workflows/deploy.yml`.
- 아직 미배포 상태.
