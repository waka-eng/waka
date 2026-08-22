# WAKA GLOSSARY — 같은 뼈대, 세 사투리

WAKA의 모든 이름은 이 문서를 따른다. 새 개념에 이름이 필요하면 이 표에 먼저 추가한다.

## 원칙

1. **은유는 한 우주에서만.** WAKA의 우주는 들판과 하늘이다. 별, 뿌리, 계절, 모닥불, 문, 노을 — 전부 여기서 나온다. 다른 세계의 은유(금고, 잉크, 영수증)를 섞지 않는다.
2. **이름은 사용자가 만지는 것에만.** 내부 동작(예: 최신 사실 우선 등)은 이름 없이 "조용한 올바름"으로 존재한다. 만든 단어가 많아지면 시가 아니라 수수께끼가 된다.
3. **방언 경계.** 데이터·API = 인프라 영어 / UI = WAKA 언어(ko) + 맨말 / 영업·기술 문서 = 인프라 영어. 셋은 같은 기능의 다른 이름이다.
4. **엄마 테스트.** 모든 은유는 hover/tap 한 줄로 설명 가능해야 한다. 아래 표의 "맨말"이 그 한 줄이다.

## 번역표

| 개념(메커니즘) | 데이터·API (영어, 지루하게) | UI (ko) | UI 맨말 한 줄 | 문서·영업 (en) | 상태 |
|---|---|---|---|---|---|
| 사용자 고정 문장 | `locked: boolean`, `locked_at` | **별** | 내가 직접 쓴 문장 — WAKA가 다시 쓰지 않아요 | User-locked immutable statement (immutable override) | **오늘** |
| 근거 링크 | `sources: SourceRef[]` — `record_id`, `excerpt`, `linked_at` | **뿌리** | 이 signal이 자란 기억들이에요 | Provenance (evidence links) | **오늘** |
| 버전 보존 | `versions[]` (soft-invalidate, 삭제 없음) | **계절** | 지난 계절의 나 — 지워지지 않고 남아요 | Version history (invalidate-don't-delete) | 예약 |
| 공유 공간 | `space`, `membership` | **모닥불** | 함께 지피는 기억이에요 | Governed shared spaces | 예약 |
| 접근 제어 | `permissions` | **문** | 누구에게 어떤 문을 열지 정해요 | Access control | 예약 |
| 소멸·은퇴 | `dormant_at` | **지다** | 오래 안 쓰인 signal은 노을처럼 져요 | Decay / retirement policy | 예약 |
| 행동 귀속 | `decision_trace` | **선택의 뿌리** | 이 선택이 어느 기억에서 왔는지예요 | Attribution / decision audit | 예약 |

## UI 금지어

잠금, lock, 출처, provenance, 버전, version, 감사, audit, 히스토리.
예외: 설정 화면의 법적 고지, 개발자용 문서. 예외 사용 시 주석으로 사유를 남긴다.

---

*리포 주석: 표의 "데이터·API" 열은 도착 지점의 모양이며, 이 리포의 현재 캐논 식별자와
다를 수 있다(예: lock은 `lockedAt` timestamp로, 근거 링크는 `signal_evidence`
M:N 테이블로 이미 존재한다). 캐논과 이 표가 충돌하면 `docs/data-model.md`가 이긴다 —
표는 방언 경계와 UI 언어의 진실이고, 스키마의 진실은 캐논이다.*
