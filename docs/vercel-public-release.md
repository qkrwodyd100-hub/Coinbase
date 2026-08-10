# Vercel 공개 배포 환경변수 가이드

이 문서는 `qkrwodyd100-hub/Coinbase`를 공개 저장소로 전환하기 전에 Vercel 설정을 안전하게 확인하기 위한 운영 가이드입니다. 실제 토큰, 키, 비밀번호, webhook URL 전체 값은 이 문서나 저장소에 기록하지 않습니다.

## 현재 애플리케이션 상태

- 현재 코드의 서버 라우트와 빌드에는 환경변수가 필요하지 않습니다.
- 시장 데이터는 인증이 필요 없는 공개 API를 서버의 `GET /api/signals`에서 호출합니다.
- 따라서 현재 Vercel에서 새 환경변수를 입력할 필요가 없습니다.
- `.env.example`에는 의도적으로 환경변수 할당이나 실제 값, placeholder가 없습니다. 향후 환경변수가 필요해질 때까지 주석만 있는 상태가 올바릅니다.

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
