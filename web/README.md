# 딱코 (Ddak-Co)

한 줄 아이디어로 Claude가 기획서를 만들어 주는 Next.js 앱입니다.

## 메인 화면에서 쓰는 API

| 경로 | 역할 |
|------|------|
| `POST /api/agent/design` | 아이디어 → 설계 JSON |
| `POST /api/agent/code` | 설계 → 생성 코드 파일 목록 |
| `POST /api/agent/ui` | 초안 코드 → UI 개선 |
| `POST /api/agent/qa` | 코드 → 빌드 통과용 점검 |
| `POST /api/deploy` | GitHub 푸시 + Vercel 배포(초안·재배포) |

## 로컬에서 실행

```bash
cd web
npm install
cp .env.example .env.local
# .env.local에 필수: ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_ORG, VERCEL_TOKEN, VERCEL_TEAM_ID
# 선택: ANTHROPIC_MODEL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(배포 기록용)
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 엽니다.

## 테스트

```bash
cd web
npm run test
```

`src/lib/*.test.ts` — 공통 유틸(Anthropic JSON 펜스 제거, `files` 정규화, 미사용 `useState` setter 후처리 등) 단위 테스트.

`main` 브랜치에 push·PR 시 저장소 루트의 **GitHub Actions**에서 `npm run test` → `typecheck` → `build`를 자동 실행합니다 (`.github/workflows/ci.yml`).

## 환경 변수

| 이름 | 필수 | 설명 |
|------|------|------|
| `ANTHROPIC_API_KEY` | 예 | Anthropic API 키 (에이전트 라우트) |
| `ANTHROPIC_MODEL` | 아니오 | 사용할 모델 ID (미설정 시 코드 기본값) |
| `GITHUB_TOKEN` | 예 | GitHub PAT (`/api/deploy`에서 레포·푸시) |
| `GITHUB_ORG` | 예 | 딱코 GitHub 조직 이름 |
| `VERCEL_TOKEN` | 예 | Vercel REST API 토큰 (`/api/deploy`) |
| `VERCEL_TEAM_ID` | 예 | 딱코 Vercel Team ID |
| `SUPABASE_URL` | 아니오 | 배포 기록 저장 시 (`/api/deploy` — 없으면 해당 단계만 생략, 배포는 성공 처리) |
| `SUPABASE_SERVICE_ROLE_KEY` | 아니오 | Supabase **service_role** 키. `SUPABASE_URL`과 함께 설정 |

**Supabase 배포 기록:** 둘 다 설정하면 `/api/deploy`가 성공 후 `POST {SUPABASE_URL}/rest/v1/deployments` 로 한 줄을 넣습니다. 테이블 예시 컬럼: `userId`, `projectName`, `deployUrl`, `createdAt`(코드와 스키마가 맞아야 함). 미설정이면 로그에만 실패가 남고 사용자에게는 배포 URL이 그대로 반환됩니다.

`.env.local`은 Git에 올리지 마세요. 팀·배포 환경에는 Vercel 대시보드 등에서 동일한 키 이름으로 설정합니다.

## Vercel에 배포

1. [Vercel](https://vercel.com)에 로그인하고 **Add New… → Project**로 Git 저장소를 연결합니다.
2. 저장소 루트가 `web`이 아니라 상위 폴더(예: `Ddak-Co`)인 경우, 프로젝트 설정의 **Root Directory**를 `web`으로 지정합니다.
3. **Environment Variables**에 `.env.example`에 적힌 이름 그대로 변수를 추가합니다.  
   - 필수: `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_ORG`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`  
   - 선택: `ANTHROPIC_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
4. `/api/deploy` 등 일부 API는 **수 분**까지 실행될 수 있습니다. Vercel **Pro** 등에서 라우트 `maxDuration`과 플랜 한도를 확인하세요(Hobby는 더 짧을 수 있습니다).
5. **Deploy**를 누르면 `npm install` → `npm run build`가 실행되고 배포가 완료됩니다.

이 저장소의 `vercel.json`은 Next.js 빌드 방식을 명시해 두었습니다. 루트 디렉터리만 `web`으로 맞추면 추가 설정 없이 동작하는 경우가 많습니다.

## 스택

Next.js(App Router), Anthropic Claude API, GitHub REST API, Vercel REST API, Tailwind CSS, shadcn/ui 스타일 컴포넌트
