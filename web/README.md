# 딱코 (Ddak-Co)

한 줄 아이디어로 Claude가 기획서를 만들어 주는 Next.js 앱입니다.

## 로컬에서 실행

```bash
cd web
npm install
cp .env.example .env.local
# .env.local에 ANTHROPIC_API_KEY, E2B_API_KEY 등을 채운 뒤
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 엽니다.

## 환경 변수

| 이름 | 필수 | 설명 |
|------|------|------|
| `ANTHROPIC_API_KEY` | 예 | Anthropic API 키 |
| `ANTHROPIC_MODEL` | 아니오 | 사용할 모델 ID (미설정 시 코드 기본값) |
| `E2B_API_KEY` | 예 (`/api/build`) | E2B 샌드박스 API 키 |
| `E2B_SANDBOX_TEMPLATE` | 아니오 | 샌드박스 템플릿(기본 `node`) |

`.env.local`은 Git에 올리지 마세요. 팀·배포 환경에는 Vercel 대시보드 등에서 동일한 키 이름으로 설정합니다.

## Vercel에 배포

1. [Vercel](https://vercel.com)에 로그인하고 **Add New… → Project**로 Git 저장소를 연결합니다.
2. 저장소 루트가 `web`이 아니라 상위 폴더(예: `Ddak-Co`)인 경우, 프로젝트 설정의 **Root Directory**를 `web`으로 지정합니다.
3. **Environment Variables**에 `.env.example`에 적힌 이름 그대로 변수를 추가합니다.  
   - `ANTHROPIC_API_KEY`, `E2B_API_KEY`는 **Production**(필요하면 Preview/Development도)에 넣습니다.  
   - `ANTHROPIC_MODEL`, `E2B_SANDBOX_TEMPLATE`은 선택입니다.
4. `/api/build`는 최대 약 5분까지 실행될 수 있습니다. Vercel **Pro** 등에서 `maxDuration`이 허용하는 한도를 확인하세요(Hobby는 제한이 더 짧을 수 있습니다).
5. **Deploy**를 누르면 `npm install` → `npm run build`가 실행되고 배포가 완료됩니다.

이 저장소의 `vercel.json`은 Next.js 빌드 방식을 명시해 두었습니다. 루트 디렉터리만 `web`으로 맞추면 추가 설정 없이 동작하는 경우가 많습니다.

## 스택

Next.js(App Router), Anthropic Claude API, E2B(`@e2b/code-interpreter`), Tailwind CSS, shadcn/ui 스타일 컴포넌트
