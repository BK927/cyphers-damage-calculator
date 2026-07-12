# 사이퍼즈 데미지 기대값 계산기

공격킷별로 **각 캐릭터의 대표 스킬 1타 기대 데미지**를 계산해 순위로 비교하는 정적 웹앱.
Vite + React + TypeScript, GitHub Pages 배포.

## 데이터 출처

- **기본 능력치(공격/치명/체력/회피/방어/이동)** — 84명 전원, [사이퍼즈 공식](https://cyphers.nexon.com) 캐릭터 페이지에서 수집한 **정확한 공식 값**. (`src/data/characters.json`)
- **스킬 계수·데미지 공식** — 넥슨이 공식 수식을 공개하지 않아 **커뮤니티 역산 추정치**. 앱에서 편집 가능하며 UI에 "추정치"로 표기.

## 데미지 공식 (엔진: `src/engine.ts`)

```
기대값 = ⌊ (고정댐 + 퍼센트계수 × 유효공격)
        × 스킬공격력
        × (1 + 데미지 증가율)
        × (1 − 상대방어 × (1 − 방어관통))      # 방어관통: 곱연산
        × (1 + 방어무시)                        # 방어력 -n% 디버프
        × 치명/회피 기대배수
        × 상황배수(다운 0.9) ⌋
```

- **치명 ↔ 회피**: 단리 차감 대결. `diff = 치명 − 상대회피`. 양수면 그만큼(%) 치명타(×1.3), 음수면 그만큼(%) 회피(×0.4, 부분감산).
- **백어택**: 스킬공격력 +0.05.
- 최종 소수점 내림.

> ⚠️ 근/원거리 방어력은 게임 내 비공개라 표기 방어값을 %로 근사한다. 상대 방어는 전 캐릭터에 동일 적용되므로 **순위에는 영향을 주지 않고 절대값만 스케일**한다.

## 공격킷 (`src/data/kits.ts`)

현재 값은 **구조 시연용 예시(placeholder)**다. 실제 게임 킷 이름/버프 수치로 이 파일만 교체하면 된다.
킷은 스탯 버프(`flat`/`percent`)와 `damageIncrease`·`penetration`·`defenseReduction` 옵션을 가진다.

## 개발

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm build    # 타입체크 + 프로덕션 빌드 → dist/
```

## 배포 (GitHub Pages)

1. 이 프로젝트를 `cyphers-damage-calculator` 이름의 GitHub 저장소로 push (`main` 브랜치).
   - 저장소 이름이 다르면 `vite.config.ts`의 `base` 값을 그 이름으로 바꿀 것.
2. GitHub 저장소 → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. `main`에 push하면 `.github/workflows/deploy.yml`이 자동 빌드·배포한다.
   결과: `https://<사용자명>.github.io/cyphers-damage-calculator/`
