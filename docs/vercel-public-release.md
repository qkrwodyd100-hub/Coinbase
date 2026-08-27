# Vercel 공개 배포 및 Git integration 운영 가이드

이 문서는 `qkrwodyd100-hub/Coinbase`를 공개 저장소로 전환하기 전에 Vercel 설정을 안전하게 확인하기 위한 운영 가이드입니다. 실제 토큰, 키, 비밀번호, webhook URL 전체 값은 이 문서나 저장소에 기록하지 않습니다.

## 현재 애플리케이션 상태

- 현재 코드의 서버 라우트와 빌드에는 환경변수가 필요하지 않습니다.
- 시장 데이터는 인증이 필요 없는 공개 API를 서버의 `GET /api/signals`에서 호출합니다.
- 따라서 현재 Vercel에서 새 환경변수를 입력할 필요가 없습니다.
- `.env.example`에는 의도적으로 환경변수 할당이나 실제 값, placeholder가 없습니다. 향후 환경변수가 필요해질 때까지 주석만 있는 상태가 올바릅니다.

## Canonical URL, build identity, legacy alias

- Canonical production URL은 `https://coinbase-ivory.vercel.app`입니다. 운영 링크와 검증은 이 주소를 기준으로 합니다.
- `https://crypto-signal-dashboard-chi.vercel.app`은 별도 운영 면이 아닙니다. host 기반 permanent redirect가 canonical의 같은 path로 보냅니다.
- `GET /api/version`은 비밀값이 아닌 전체 Git commit SHA, `signals-v1` data contract, canonical URL을 JSON으로 공개합니다. Vercel Git deployment가 제공하는 `VERCEL_GIT_COMMIT_SHA`를 사용하며, 값이 없으면 `unavailable`로 fail-visible합니다.
- GitHub의 Vercel deployment status에서 production deployment URL과 commit SHA를 확인하고, `/api/version`의 SHA가 그 commit과 같은지 대조합니다. 토큰이나 환경변수 값은 기록하지 않습니다.

배포 후 두 alias가 하나의 선언된 build와 API contract로 수렴하는지 다음 명령으로 확인합니다.

```bash
npm run smoke:deployment
```

이 smoke는 legacy alias의 redirect status/location, 두 URL의 최종 `/api/version` 응답, 전체 40자리 Git SHA, `signals-v1`, `/api/signals`의 8개 자산 순서를 함께 검증합니다.

### Alias 변경 롤백

1. GitHub/Vercel에서 직전 정상 production deployment의 Git SHA와 deployment URL을 기록합니다.
2. redirect 또는 version endpoint에 결함이 있으면 변경 commit을 `git revert <sha>`로 되돌려 `main`에 push합니다. history를 rewrite하지 않습니다.
3. 긴급한 alias-only 롤백은 Vercel Dashboard의 해당 프로젝트 **Deployments**에서 직전 정상 deployment를 Promote/Redeploy한 뒤 canonical `/api/version`과 `/api/signals`를 확인합니다.
4. `crypto-signal-dashboard-chi.vercel.app`을 다시 독립 서비스로 운영하지 않습니다. redirect를 일시 제거해야 한다면 두 host가 같은 production deployment SHA를 선언하도록 먼저 명시적으로 alias를 재지정합니다.
5. 롤백 후 `npm run smoke:deployment`를 다시 실행하고 canonical root/API HTTP 200, legacy redirect, 동일 commit/data contract를 확인합니다.

## `public` Output Directory 오류의 원인과 저장소 설정

이 저장소는 루트 `package.json`의 `build` script로 `next build`를 실행하는 Next.js 애플리케이션이며, 로컬 빌드 산출물은 `.next/`입니다. 정적 사이트용 `public/` 산출물을 만드는 script도, 추적된 `public/` 디렉터리도 없습니다. 따라서 다음 오류는 저장소 build가 `public/` 생성을 빠뜨렸다는 뜻이 아니라 Vercel 프로젝트의 **Output Directory override가 `public`으로 남아 있었다는 증거**입니다.

```text
No Output Directory named public found after the Build completed
```

루트 `vercel.json`은 Git deployment마다 다음 값을 적용합니다.

- `framework: "nextjs"`: Dashboard의 오래된 Framework Preset보다 저장소의 실제 프레임워크를 우선합니다.
- `buildCommand: "npm run build"`: `package.json`과 같은 build를 사용합니다.
- `outputDirectory: null`: `public` 같은 수동 경로를 사용하지 않고 Vercel이 Next.js 산출물을 자동 감지하게 합니다. Vercel schema에서도 `null`은 자동 감지를 뜻합니다.

`.next`를 수동 Output Directory로 고정하지 않습니다. Next.js의 route handler와 서버 산출물은 단순 정적 디렉터리 배포가 아니므로 Vercel의 Next.js framework 처리를 유지해야 합니다.

## CLI 없이 Dashboard + Git으로 배포 복구

### 1. Project Settings 확인

Vercel Dashboard에서 프로젝트를 열고 **Settings → Build and Deployment**에서 확인합니다.

| 항목 | 값 | 이유 |
| --- | --- | --- |
| Root Directory | 비어 있음 (`.`), Override 해제 | `package.json`, `next.config.ts`, `vercel.json`이 저장소 루트에 있습니다. |
| Framework Preset | `Next.js` | App Router와 `src/app/api/signals/route.ts`를 Next.js로 빌드해야 합니다. |
| Build Command | Override 해제 권장. 켜져 있다면 `npm run build` | 저장소의 검증된 build script와 일치시킵니다. |
| Output Directory | Override 해제하고 자동 감지 | `public`을 제거하고 Next.js framework 산출물을 Vercel이 처리하게 합니다. |

`vercel.json`이 Framework, Build Command, Output Directory를 Git commit 단위로 고정하지만 Root Directory는 Dashboard 프로젝트 설정입니다. 저장소 하위 폴더를 Root Directory로 선택하면 `vercel.json`과 `package.json`을 찾지 못하므로 반드시 루트를 선택합니다.

### 2. Git 연결과 새 배포 트리거

1. **Settings → Git**에서 연결 저장소가 `qkrwodyd100-hub/Coinbase`, Production Branch가 `main`인지 확인합니다.
2. 검증된 수정 commit을 `main`에 push합니다. Git integration이 그 commit으로 새 Production deployment를 생성하므로 Vercel CLI 설치나 로그인이 필요하지 않습니다.
3. **Deployments**에서 해당 `main` commit의 deployment가 생성되었는지 확인합니다. 이전 실패 deployment를 성공으로 오인하지 않습니다.

### 3. 배포 로그 판독

새 deployment의 **Build Logs**에서 다음 순서로 확인합니다.

1. clone된 branch와 commit이 방금 push한 `main` commit인지 확인합니다.
2. Root Directory에서 루트 `package.json`을 읽고 dependency install이 성공하는지 확인합니다.
3. Framework가 Next.js로 감지되고 `npm run build`/`next build`가 실행되는지 확인합니다.
4. build가 `/`, `/_not-found`, `/api/signals` route를 생성한 뒤 성공하는지 확인합니다.
5. 로그 끝에 `public` 디렉터리를 찾는 오류가 다시 나오지 않는지 확인합니다.

같은 `public` 오류가 재발하면 해당 deployment가 수정 commit을 사용했는지 먼저 확인하고, Dashboard의 Output Directory override를 해제한 뒤 새 `main` push 또는 아래 Redeploy 절차를 사용합니다.

### 4. Redeploy 사용 조건

- **새 commit이 있으면:** `main` push로 새 deployment를 만드는 것을 우선합니다.
- **설정만 바꾸었고 commit은 그대로면:** **Deployments → 대상 deployment → Redeploy**를 사용합니다.
- 캐시된 잘못된 설정/산출물이 의심될 때만 Redeploy 화면에서 build cache를 사용하지 않는 옵션을 선택합니다. 평상시마다 캐시를 지울 필요는 없습니다.
- 반드시 수정된 설정과 올바른 commit을 가리키는 deployment를 선택합니다. 실패한 과거 deployment를 설정 수정 전에 그대로 재실행하지 않습니다.

CLI가 설치되지 않았거나 Vercel 계정·팀 권한 때문에 CLI로 프로젝트를 link할 수 없어도 위 절차에는 영향이 없습니다. Dashboard에서 프로젝트 설정과 deployment 로그를 보고, GitHub의 `main` push를 배포 트리거로 사용하면 됩니다. CLI 설치/로그인을 오류 해결의 선행조건으로 강제하지 않습니다.

## 공개 전 Vercel 확인 절차

1. Vercel Dashboard에서 해당 프로젝트를 엽니다.
2. **Settings → Environment Variables**를 엽니다.
3. 기존 항목의 이름과 적용 범위만 검토합니다. 값은 복사하거나 Slack, GitHub issue, commit, 문서에 기록하지 않습니다.
4. 토큰, API key, private key, password, 서비스 계정 JSON, 인증 정보가 포함된 URL, webhook URL은 모두 민감값으로 취급합니다.
5. 민감값이 있다면 저장소 코드에는 `process.env.변수명`으로만 참조되고, 클라이언트 번들에 노출되는 접두사가 없는지 확인합니다.
6. 새 `main` push 또는 수동 Redeploy를 선택한 경우에만 해당 Production deployment의 Git 연결과 배포 로그에 값이 출력되지 않는지 확인합니다.

## 공개 전환 후 배포 판단

- GitHub 저장소의 private → public 공개 범위 변경만으로는 애플리케이션 소스나 Vercel 환경변수 구성이 바뀌지 않습니다. 이 변경만을 이유로 재배포가 필수는 아닙니다.
- 연결된 Git integration에서 새 `main` commit은 새 Production deployment를 트리거합니다. 따라서 공개 전환 감사에서 저장소 변경을 반영하려면 검증된 `main` push가 안전한 배포 트리거입니다.
- 코드 변경 없이 현재 commit을 다시 빌드해야 할 때만 Vercel Dashboard의 **Deployments → 대상 Production deployment → Redeploy**를 사용합니다. Redeploy는 같은 commit을 다시 빌드하는 별도 선택지입니다.
- Vercel 연결 상태는 Vercel Dashboard의 **Settings → Git**에서 이 GitHub 저장소와 Production Branch가 `main`인지 확인합니다. 이 저장소에는 Vercel CLI 설정 또는 추적된 `.vercel/` 메타데이터가 없으므로, 이 확인은 Vercel 프로젝트 권한이 있는 사용자가 UI에서 수행해야 합니다.

## 향후 환경변수 추가 규칙

| 구분 | Vercel 적용 범위 | 값 획득 위치 | 민감도 | 규칙 |
| --- | --- | --- | --- | --- |
| 서버 전용 비밀값 (예: 외부 API key) | 필요한 환경만 선택. 실서비스 호출이면 Production, preview 동작도 필요하면 Preview, 로컬 개발도 필요하면 Development | 해당 서비스의 보안 설정/발급 화면 | 높음 | 이름은 접두사 없이 지정하고 서버 코드에서만 `process.env`로 읽습니다. |
| 공개 가능한 런타임 설정 (예: 공개 API base URL) | 필요한 환경만 선택 | 공식 서비스 문서 또는 공개 설정 | 낮음 | 가능하면 코드 상수로 유지합니다. 클라이언트 노출이 꼭 필요할 때만 `NEXT_PUBLIC_`을 사용합니다. |
| `NEXT_PUBLIC_*` | 필요한 환경만 선택 | 공개 가능한 설정만 | 공개됨 | 브라우저 JavaScript에 포함됩니다. 토큰, key, 계정 ID, 내부 URL, 개인 webhook을 절대 넣지 않습니다. |

Vite 프로젝트라면 같은 원칙으로 `VITE_*` 값도 브라우저에 노출됩니다. 이 저장소는 Next.js 프로젝트이므로 `NEXT_PUBLIC_*`가 해당 접두사입니다.

## 안전한 추가 예시

향후 서버 전용 API key가 필요해질 경우에만 다음처럼 구성합니다.

1. Vercel **Settings → Environment Variables → Add New**에서 이름만 지정합니다. 예: `MARKET_DATA_API_KEY`.
2. 값은 서비스 발급 화면에서 직접 붙여 넣고, 필요한 Production/Preview/Development 범위만 선택합니다.
3. 코드에서는 서버 전용 모듈에서 `process.env.MARKET_DATA_API_KEY`를 검증합니다.
4. `.env.example`에는 실제 값이 아닌 명시적 placeholder만 둡니다. 예: `MARKET_DATA_API_KEY=replace-with-your-key`.
5. 브라우저 컴포넌트와 `NEXT_PUBLIC_MARKET_DATA_API_KEY`에는 이 값을 전달하지 않습니다.

## 사고 대응

- GitHub history, Vercel 로그, CI 로그, 문서에서 비밀값이 발견되면 즉시 해당 자격증명을 회전/폐기합니다. 단순 파일 삭제나 새 commit만으로는 과거 Git history에서 제거되지 않습니다.
- GitHub Secret Scanning 및 Push Protection을 활성화하고, Vercel 배포 로그와 환경변수 접근 권한을 검토합니다.
- 노출된 값을 이슈, 채팅, commit message에 재게시하지 않습니다. 조사 결과에는 변수 이름, 파일 경로, 영향 범위, 회전 완료 여부만 남깁니다.
