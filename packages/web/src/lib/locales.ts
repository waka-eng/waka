export const supportedLocaleValues = ["en-US", "ko-KR"] as const;

export type SupportedLocale = (typeof supportedLocaleValues)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en-US";

export const supportedLocales: Array<{ code: SupportedLocale; label: string; nativeLabel: string }> = [
  { code: "en-US", label: "English", nativeLabel: "English" },
  { code: "ko-KR", label: "Korean", nativeLabel: "한국어" },
];

const supportedLocaleSet = new Set<string>(supportedLocaleValues);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && supportedLocaleSet.has(value);
}

export function normalizeSupportedLocale(value: unknown): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

type TranslationKey =
  | "tagline"
  | "capture"
  | "captureAria"
  | "loadingInspirations"
  | "inspirationSaved"
  | "inspirationsSaved"
  | "languageLabel"
  | "languageSaving"
  | "homeView"
  | "wowMomentFirst"
  | "inspirationFirst"
  | "wowStatus"
  | "developmentStatus"
  | "wowMoments"
  | "inspirationFilters"
  | "findInspirationsEyebrow"
  | "searchRawMaterial"
  | "howScoringWorks"
  | "search"
  | "searchInspirations"
  | "searchPlaceholder"
  | "noInspirationsMatch"
  | "broaderSearchHint"
  | "sortInspirations"
  | "sortByInspirationText"
  | "sortBySavedTime"
  | "sortByWowScore"
  | "inspirationText"
  | "savedTime"
  | "wowScore"
  | "notSorted"
  | "ascending"
  | "descending"
  | "savedStatus"
  | "resultsLabelSingular"
  | "resultsLabelPlural"
  | "capturePlaceholder"
  | "quickSave"
  | "processThisInspiration"
  | "reflectiveSaveAria"
  | "focusMode"
  | "enterFocusMode"
  | "exitFocusMode"
  | "saved"
  | "savedWithReflection"
  | "addThoughtBeforeReflectiveSave"
  | "reflectionQuestion"
  | "reflectionPlaceholder"
  | "done"
  | "continue"
  | "wowMomentsHeading"
  | "wowMomentsEmptyTitle"
  | "wowMomentsEmptyHint"
  | "wowMomentsLoading"
  | "wowMomentsLoadError"
  | "bestRecentMirrorMomentsShown"
  | "devWowInspectButton"
  | "devWowInspectionKicker"
  | "devWowInspectionClose"
  | "devWowInspectionTitle"
  | "devWowInspectionNote"
  | "devWowUntitledMoment"
  | "devWowFieldNotGenerated"
  | "devWowFieldTitle"
  | "devWowFieldWhy"
  | "devWowFieldBelief"
  | "devWowFieldReflection"
  | "devWowFieldReflectionGuide"
  | "wowReflectionGuideTitle"
  | "wowReflectionGuideCaption"
  | "devWowFieldCompactCounts"
  | "devWowSourceRoleReason"
  | "devWowSourceFallbackLabel"
  | "devWowSourceFallbackReason"
  | "internalWowStatusAria"
  | "latestWowCount"
  | "savedInspiration"
  | "adminJobDetailsUnavailable"
  | "backgroundJobChecking"
  | "backgroundJobStatus"
  | "newWowMomentFound"
  | "noNewWowYet"
  | "wowRefreshChecking"
  | "developmentWowStatus"
  | "refreshing"
  | "refresh"
  | "inspiration"
  | "job"
  | "embedded"
  | "generatedWow"
  | "whyNoWow"
  | "rawJudgeLog"
  | "loadingWowPipelineStatus"
  | "noRecentInspirations"
  | "none"
  | "yes"
  | "no"
  | "ready"
  | "temporaryDevelopmentSurface"
  | "wowPipelineStatus"
  | "wowStatusExplainer"
  | "savedInspirationGuide"
  | "jobGuide"
  | "embeddedGuide"
  | "generatedWowGuide"
  | "whyNoWowGuide"
  | "rawJudgeLogGuide"
  | "signOut"
  | "signOutPerson";

const translations: Record<SupportedLocale, Record<TranslationKey, string>> = {
  "en-US": {
    tagline: "your inspirations",
    capture: "Capture",
    captureAria: "Capture a new inspiration",
    loadingInspirations: "loading inspirations…",
    inspirationSaved: "inspiration saved",
    inspirationsSaved: "inspirations saved",
    languageLabel: "Language",
    languageSaving: "Saving language…",
    homeView: "Home view",
    wowMomentFirst: "Wow Moment First",
    inspirationFirst: "Inspiration First",
    wowStatus: "WOW STATUS",
    developmentStatus: "development status",
    wowMoments: "wow moments",
    inspirationFilters: "Inspiration filters",
    findInspirationsEyebrow: "Find inspirations",
    searchRawMaterial: "Search the raw material",
    howScoringWorks: "How scoring works",
    search: "Search",
    searchInspirations: "Search inspirations",
    searchPlaceholder: "Search your inspiration archive…",
    noInspirationsMatch: "No inspirations match those filters.",
    broaderSearchHint: "Try a broader search or clear the text query.",
    sortInspirations: "Sort inspirations",
    sortByInspirationText: "Sort by inspiration text",
    sortBySavedTime: "Sort by saved time",
    sortByWowScore: "Sort by WOW score",
    inspirationText: "Inspiration text",
    savedTime: "Saved/time",
    wowScore: "WOW score",
    notSorted: "not sorted",
    ascending: "ascending",
    descending: "descending",
    savedStatus: "saved",
    resultsLabelSingular: "inspiration",
    resultsLabelPlural: "inspirations",
    capturePlaceholder: "A link, a note, an image — whatever's inspiring you right now…",
    quickSave: "Quick save",
    processThisInspiration: "Process this inspiration",
    reflectiveSaveAria: "Process this inspiration with a reflection",
    focusMode: "Focus mode",
    enterFocusMode: "Enter focus mode",
    exitFocusMode: "Exit focus mode",
    saved: "Saved",
    savedWithReflection: "Saved with reflection",
    addThoughtBeforeReflectiveSave: "Add a thought before reflective save",
    reflectionQuestion: "What about this is worth remembering?",
    reflectionPlaceholder: "What question, connection, or signal should your future self keep?",
    done: "Done",
    continue: "Continue",
    wowMomentsHeading: "What WAKA noticed",
    wowMomentsEmptyTitle: "No WOW moments yet.",
    wowMomentsEmptyHint: "Keep saving inspirations; patterns will appear here.",
    wowMomentsLoading: "Loading WOW moments…",
    wowMomentsLoadError: "Couldn’t load WOW moments.",
    bestRecentMirrorMomentsShown: "best-recent mirror moments shown.",
    devWowInspectButton: "Dev-only inspect WOW fields",
    devWowInspectionKicker: "Temporary internal inspection",
    devWowInspectionClose: "Close",
    devWowInspectionTitle: "Generated field previews",
    devWowInspectionNote: "Safe, bounded previews of generated fields for live internal testing. This panel is only shown behind the internal development gate.",
    devWowUntitledMoment: "Untitled WOW moment",
    devWowFieldNotGenerated: "Not generated",
    devWowFieldTitle: "Title / headline",
    devWowFieldWhy: "Why / meaning copy",
    devWowFieldBelief: "Belief statement",
    devWowFieldReflection: "Reflection prompt",
    devWowFieldReflectionGuide: "Reflection guide",
    wowReflectionGuideTitle: "A gentle way to reflect",
    wowReflectionGuideCaption: "Use this as a loose path, not homework.",
    devWowFieldCompactCounts: "Compact counts",
    devWowSourceRoleReason: "Source role / reason",
    devWowSourceFallbackLabel: "Source inspiration",
    devWowSourceFallbackReason: "Why this source matters",
    internalWowStatusAria: "Internal/demo-only WOW pipeline status",
    latestWowCount: "Latest WOW count",
    savedInspiration: "Saved inspiration",
    adminJobDetailsUnavailable: "Admin job details unavailable; WOW refresh still polling.",
    backgroundJobChecking: "Background classification job checking",
    backgroundJobStatus: "Background classification job",
    newWowMomentFound: "New WOW moment found",
    noNewWowYet: "No new WOW yet",
    wowRefreshChecking: "WOW refresh checking",
    developmentWowStatus: "Development WOW status",
    refreshing: "Refreshing",
    refresh: "Refresh",
    inspiration: "Inspiration",
    job: "Job",
    embedded: "Embedded",
    generatedWow: "Generated WOW",
    whyNoWow: "Why no WOW?",
    rawJudgeLog: "Raw judge log",
    loadingWowPipelineStatus: "Loading WOW pipeline status…",
    noRecentInspirations: "No recent inspirations.",
    none: "none",
    yes: "yes",
    no: "no",
    ready: "ready",
    temporaryDevelopmentSurface: "Temporary development surface",
    wowPipelineStatus: "WOW pipeline status",
    wowStatusExplainer: "This tab is for development verification only and will be removed before the product experience is finalized. It shows recent saves moving through the WOW pipeline without exposing secrets or changing API/auth boundaries.",
    savedInspirationGuide: "The saved inspiration id, save time, and text preview being checked.",
    jobGuide: "Whether the background classification/processing job is queued, running, done, or missing.",
    embeddedGuide: "Whether a retrieval embedding exists for relationship matching.",
    generatedWowGuide: "The generated/linked WOW count visible to the current tenant.",
    whyNoWowGuide: "The likely debug reason when generated WOW is 0: waiting for job, missing embedding, failed job, or no WOW generated.",
    rawJudgeLogGuide: "Gemini raw preview and schema/finish diagnostics when present.",
    signOut: "Sign out",
    signOutPerson: "Sign out",
  },
  "ko-KR": {
    tagline: "당신의 영감",
    capture: "기록",
    captureAria: "새 영감 기록하기",
    loadingInspirations: "영감을 불러오는 중…",
    inspirationSaved: "개의 영감 저장됨",
    inspirationsSaved: "개의 영감 저장됨",
    languageLabel: "언어",
    languageSaving: "언어 저장 중…",
    homeView: "홈 보기",
    wowMomentFirst: "와우 순간 먼저",
    inspirationFirst: "영감 먼저",
    wowStatus: "WOW 상태",
    developmentStatus: "개발 상태",
    wowMoments: "와우 순간",
    inspirationFilters: "영감 필터",
    findInspirationsEyebrow: "영감 찾기",
    searchRawMaterial: "원천 자료 검색",
    howScoringWorks: "점수 방식 보기",
    search: "검색",
    searchInspirations: "영감 검색",
    searchPlaceholder: "영감 아카이브 검색…",
    noInspirationsMatch: "필터와 일치하는 영감이 없습니다.",
    broaderSearchHint: "더 넓게 검색하거나 검색어를 지워 보세요.",
    sortInspirations: "영감 정렬",
    sortByInspirationText: "영감 텍스트로 정렬",
    sortBySavedTime: "저장 시간으로 정렬",
    sortByWowScore: "WOW 점수로 정렬",
    inspirationText: "영감 텍스트",
    savedTime: "저장/시간",
    wowScore: "WOW 점수",
    notSorted: "정렬 안 됨",
    ascending: "오름차순",
    descending: "내림차순",
    savedStatus: "저장됨",
    resultsLabelSingular: "영감",
    resultsLabelPlural: "영감",
    capturePlaceholder: "링크, 메모, 이미지 — 지금 영감을 주는 무엇이든…",
    quickSave: "빠른 저장",
    processThisInspiration: "이 영감 처리하기",
    reflectiveSaveAria: "회고와 함께 이 영감 처리하기",
    focusMode: "집중 모드",
    enterFocusMode: "집중 모드로 들어가기",
    exitFocusMode: "집중 모드 종료",
    saved: "저장됨",
    savedWithReflection: "회고와 함께 저장됨",
    addThoughtBeforeReflectiveSave: "회고 저장 전에 생각을 추가하세요",
    reflectionQuestion: "이 영감에서 무엇을 기억할 가치가 있나요?",
    reflectionPlaceholder: "미래의 나에게 어떤 질문, 연결, 신호를 남길까요?",
    done: "완료",
    continue: "계속",
    wowMomentsHeading: "WAKA가 포착한 것",
    wowMomentsEmptyTitle: "아직 WOW 순간이 없습니다.",
    wowMomentsEmptyHint: "영감을 계속 저장하면 패턴이 여기에 나타납니다.",
    wowMomentsLoading: "WOW 순간을 불러오는 중…",
    wowMomentsLoadError: "WOW 순간을 불러오지 못했습니다.",
    bestRecentMirrorMomentsShown: "개의 최근 핵심 미러 순간이 표시됨.",
    devWowInspectButton: "개발 전용 WOW 필드 점검",
    devWowInspectionKicker: "임시 내부 점검",
    devWowInspectionClose: "닫기",
    devWowInspectionTitle: "생성 필드 미리보기",
    devWowInspectionNote: "실시간 내부 테스트를 위한 안전하고 제한된 생성 필드 미리보기입니다. 이 패널은 내부 개발 게이트 뒤에서만 표시됩니다.",
    devWowUntitledMoment: "제목 없는 WOW 순간",
    devWowFieldNotGenerated: "생성되지 않음",
    devWowFieldTitle: "제목 / 헤드라인",
    devWowFieldWhy: "의미 / 설명 문구",
    devWowFieldBelief: "믿음 문장",
    devWowFieldReflection: "회고 질문",
    devWowFieldReflectionGuide: "회고 가이드",
    wowReflectionGuideTitle: "부드럽게 돌아보는 방법",
    wowReflectionGuideCaption: "숙제가 아니라 느슨한 길잡이로 사용하세요.",
    devWowFieldCompactCounts: "간단 집계",
    devWowSourceRoleReason: "출처 역할 / 이유",
    devWowSourceFallbackLabel: "출처 영감",
    devWowSourceFallbackReason: "이 출처가 중요한 이유",
    internalWowStatusAria: "내부/데모 전용 WOW 파이프라인 상태",
    latestWowCount: "최신 WOW 수",
    savedInspiration: "저장된 영감",
    adminJobDetailsUnavailable: "관리자 작업 세부 정보를 사용할 수 없습니다. WOW 새로고침은 계속 확인 중입니다.",
    backgroundJobChecking: "백그라운드 분류 작업 확인 중",
    backgroundJobStatus: "백그라운드 분류 작업",
    newWowMomentFound: "새 WOW 순간 발견",
    noNewWowYet: "아직 새 WOW 없음",
    wowRefreshChecking: "WOW 새로고침 확인 중",
    developmentWowStatus: "개발용 WOW 상태",
    refreshing: "새로고침 중",
    refresh: "새로고침",
    inspiration: "영감",
    job: "작업",
    embedded: "임베딩",
    generatedWow: "생성된 WOW",
    whyNoWow: "왜 WOW가 없나요?",
    rawJudgeLog: "원본 판정 로그",
    loadingWowPipelineStatus: "WOW 파이프라인 상태를 불러오는 중…",
    noRecentInspirations: "최근 영감이 없습니다.",
    none: "없음",
    yes: "예",
    no: "아니요",
    ready: "준비됨",
    temporaryDevelopmentSurface: "임시 개발 화면",
    wowPipelineStatus: "WOW 파이프라인 상태",
    wowStatusExplainer: "이 탭은 개발 검증 전용이며 제품 경험이 확정되기 전에 제거될 예정입니다. 비밀을 노출하거나 API/인증 경계를 바꾸지 않고 최근 저장이 WOW 파이프라인을 지나는 과정을 보여줍니다.",
    savedInspirationGuide: "확인 중인 저장된 영감 ID, 저장 시간, 텍스트 미리보기입니다.",
    jobGuide: "백그라운드 분류/처리 작업이 대기 중인지, 실행 중인지, 완료됐는지, 누락됐는지 보여줍니다.",
    embeddedGuide: "관계 매칭을 위한 검색 임베딩이 있는지 보여줍니다.",
    generatedWowGuide: "현재 테넌트에 표시되는 생성/연결된 WOW 수입니다.",
    whyNoWowGuide: "생성된 WOW가 0일 때의 예상 디버그 이유입니다: 작업 대기, 임베딩 누락, 작업 실패 또는 WOW 미생성.",
    rawJudgeLogGuide: "있을 경우 Gemini 원본 미리보기와 스키마/완료 진단입니다.",
    signOut: "로그아웃",
    signOutPerson: "로그아웃",
  },
};

export function t(locale: SupportedLocale | null | undefined, key: TranslationKey): string {
  return translations[normalizeSupportedLocale(locale)][key];
}
