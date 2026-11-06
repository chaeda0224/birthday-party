# 생일 정상처리

검은 배경의 3D 케이크와 촛불로 함께 축하하는 웹앱.

공개 주소: https://chaeda0224.github.io/birthday-party/

## 사용

휴대폰 한 대에서는 `혼자 축하하기`, 여러 기기에서는 `함께 축하하기`로 시작합니다. 진행자가 이름·월일·연출·사진을 설정하고 QR 또는 초대 링크를 공유합니다. 태블릿은 선택 사항입니다.

흔들기·기울기 센서와 마이크는 버튼을 눌러 직접 켭니다. 권한 거절·미지원 기기에서는 버튼으로 참여할 수 있습니다. 한 기기만 음향을 담당하며 불기 단계에는 효과음을 멈춥니다. 참여 기기 한 대에서 입김이 한 번 감지되면 방 전체가 소등됩니다. 마이크 원음은 전송하거나 녹음하지 않습니다.

긴 촛불은 10살, 짧은 촛불은 1살로 직접 개수를 고릅니다. 사진은 케이크 토퍼·전체 배경·둘 다를 선택합니다. 지원 기기에서 `기울여 둘러보기`를 켜면 구도와 불꽃이 반응합니다.

단독 정보는 메모리에만 유지하고 새로고침하면 지웁니다. 공동 방은 익명 인증·초대·RLS를 사용하며 기본 유효기간은 2시간입니다. 사진은 서버에서 재인코딩해 비공개 저장소에 보관합니다. 종료·만료 후 접근을 막고 삭제 작업을 수행합니다. 이미 내려받은 사진과 브라우저·서비스 캐시의 즉시 회수는 보장하지 않습니다.

## 개발

Node 22 이상에서 `npm ci`, `npm run dev`로 시작합니다. `.env.local`에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`를 설정하면 공동 방 기능을 활성화합니다. 이 두 값은 브라우저용 공개 설정입니다. 서버 비밀키는 프런트엔드에 넣지 않습니다.

`npm run typecheck`, `npm run lint`, `npm run test:unit`, `node --test tests/devices.test.mjs tests/backend-contract.test.mjs`, `npm run build`, `npm run check:public`로 검사합니다. `scripts/test-live.mjs`와 `scripts/test-photo-live.mjs`는 설정된 프로젝트에 가상 표식의 시험 방을 만들고 종료하는 실제 서비스 시험입니다.

서버 설치는 `supabase/migrations`의 SQL을 파일명 순서대로 적용하고 `supabase/functions/photo/index.ts`를 배포합니다. photo 함수는 레거시 JWT 게이트 대신 함수 안에서 Supabase 사용자 JWT를 확인하므로 `verify_jwt=false` 설정을 사용합니다. 정리 트리거는 객체·방 인자를 받지 않고 만료된 데이터만 처리하며 DB 잠금으로 1분당 한 번 제한합니다.

## 검증 범위

현재 브라우저·단위·Postgres 엔진·실제 Supabase API 시험을 진행했습니다. 실제 iPhone/iPad/Android의 마이크·가속도, 3대·10대 동시 동작은 실기기 확인이 필요합니다. `QA_MATRIX.md`의 계획을 자동으로 통과로 간주하지 않습니다. 세부 결과는 `docs/VERIFICATION_REPORT.md`와 `docs/IMPLEMENTATION_REPORT.md`에 기록합니다.

3D를 지원하지 않는 기기에는 정적 케이크 대체 화면이 표시됩니다. WebGL 장면의 조명·크림·촛불은 Three.js로 렌더링합니다. Candle HD, Soonsoon Candle Light, A Small Flame의 검은 배경·불꽃 중심 화면 구성을 참고했으며 해당 앱의 이미지·코드는 복제하지 않았습니다.

## 공개 범위

소스·빌드 설정·안전한 문서만 공개합니다. 실제 이름·생일·사진·운영 초대 링크·인증 세션·서버 비밀·로컬 시험 캡처는 저장소에 넣지 않습니다. 자체 형식 점검은 PCFilter나 이미지·바이너리 검사를 대신하지 않습니다. 의존 패키지의 라이선스와 필수 고지는 유지합니다.
