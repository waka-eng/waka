/** Fixed synthetic sources and labels, declared before any live vectors.
 * Allowed matches include useful neighboring context, not only exact targets. */
export interface RetrievalSource {id:string;text:string;cluster:string;foreign?:boolean;reflection?:string;media?:{type:'image'|'audio'|'link';text:string;correction?:string}}
export const retrievalSources:RetrievalSource[]=[
  {id:'mornings',cluster:'space',text:'I leave the first half hour of my mornings without meetings so I can think slowly.'},
  {id:'trials',cluster:'trials',text:'I test new interests with a small reversible experiment before making a long commitment.'},
  {id:'trial-copy',cluster:'trials',text:'Before a long commitment, I try a small reversible experiment with a new interest.'},
  {id:'family',cluster:'family',text:'I protect evening time with my family instead of taking work calls after dinner.'},
  {id:'boundaries',cluster:'boundaries',text:'Saying no to an extra project helps me keep promises I already made.'},
  {id:'pottery',cluster:'craft',text:'I enjoy making pottery by hand. The tactile resistance of clay helps me focus.'},
  {id:'rest',cluster:'space',text:'바쁘게 결과를 내는 것보다 잠시 쉬면서 내 생각을 알아차리는 시간이 필요하다. 나에게 쉼은 중요하다.'},
  {id:'walk',cluster:'space',text:'A walk by the river.',reflection:'Without headphones, I felt lighter and could hear my own thoughts.'},
  {id:'photo',cluster:'space',text:'',media:{type:'image',text:"A handwritten note reads: 'Leave breathing room between commitments'."}},
  {id:'audio',cluster:'trials',text:'',media:{type:'audio',text:'I want marathon training.',correction:'I want to learn watercolour painting through a single afternoon class before committing to regular lessons.'}},
  {id:'export',cluster:'tools',text:'',media:{type:'link',text:'Tools should store files locally and offer an export format that remains readable without a subscription.'}},
  {id:'repair',cluster:'tools',text:'I prefer small tools I can understand and repair over one opaque platform.'},
  {id:'practice',cluster:'craft',text:'I return to drawing for twenty minutes on most weekdays instead of waiting to feel inspired.'},
  {id:'music',cluster:'music',text:'I used to explore productivity systems, but this month I am spending less time optimizing and more time making music.'},
  {id:'disagreement',cluster:'collaboration',text:'I work better when we name disagreements early instead of pretending there is consensus.'},
  {id:'bread',cluster:'cooking',text:'A recipe for sourdough bread uses flour, water, salt, starter and a long fermentation.'},
  {id:'foreign',cluster:'foreign',foreign:true,text:'Private constellation: exoplanet spectrograph calibration at Zephyr Observatory.'},
];
/** required lists alternative primary matches: finding any one is a query hit. */
export interface RetrievalCase {id:string;query:string;prior?:string;required:string[];allowed:string[];semanticTarget?:boolean}
const space=['mornings','rest','walk','photo'],trials=['trials','trial-copy','audio'],tools=['export','repair'];
export const retrievalCases:RetrievalCase[]=[
  {id:'exact-mornings',query:'Find my note about mornings without meetings.',required:['mornings'],allowed:space},
  {id:'paraphrase-space',query:'How do I protect unstructured mental space?',required:['mornings','rest','walk','photo'],allowed:space,semanticTarget:true},
  {id:'short-korean',query:'쉼',required:['rest'],allowed:space,semanticTarget:true},
  {id:'korean-space',query:'생각을 정리할 여유를 어떻게 남기고 싶어 했지?',required:['rest','mornings','walk','photo'],allowed:space,semanticTarget:true},
  {id:'reflection',query:'What did I notice when I stopped listening to audio during a walk?',required:['walk'],allowed:['walk','rest'],semanticTarget:true},
  {id:'reflection-exact',query:'without headphones',required:['walk'],allowed:['walk'],semanticTarget:true},
  {id:'photo',query:'Which saved image mentions breathing room between commitments?',required:['photo'],allowed:['photo','mornings','boundaries'],semanticTarget:true},
  {id:'audio-correction',query:'watercolour painting afternoon class',required:['audio'],allowed:['audio','pottery','practice','trials','trial-copy'],semanticTarget:true},
  {id:'retracted-transcript',query:'marathon training',required:[],allowed:[]},
  {id:'link-portability',query:'How can I avoid being locked into a software subscription?',required:['export'],allowed:tools,semanticTarget:true},
  {id:'repairability',query:'What matters to me about repairability and understanding software?',required:['repair'],allowed:tools,semanticTarget:true},
  {id:'family-exact',query:'family evenings after dinner',required:['family'],allowed:['family','boundaries']},
  {id:'family-paraphrase',query:'How do I stop professional demands spilling into time with loved ones?',required:['family'],allowed:['family','boundaries'],semanticTarget:true},
  {id:'boundaries',query:'Why decline another commitment when my plate is full?',required:['boundaries'],allowed:['boundaries','family','photo','trials','trial-copy'],semanticTarget:true},
  {id:'trials',query:'What could help before committing to a new interest?',required:['trials','trial-copy'],allowed:trials},
  {id:'low-risk',query:'I want a low-risk way to explore something unfamiliar.',required:['trials','trial-copy','audio'],allowed:[...trials,'pottery'],semanticTarget:true},
  {id:'followup-en',prior:'I am thinking about protecting family evenings after dinner.',query:'What about that?',required:['family'],allowed:['family','boundaries']},
  {id:'followup-ko',prior:'주말에 새로운 관심사를 작게 시험해 보고 싶어요.',query:'그건 어떻게 생각해요?',required:['trials','trial-copy','audio'],allowed:[...trials,'pottery'],semanticTarget:true},
  {id:'practice',query:'What helps me keep drawing even when motivation is low?',required:['practice'],allowed:['practice','pottery'],semanticTarget:true},
  {id:'music-shift',query:'What did I want to do instead of optimizing productivity?',required:['music'],allowed:['music']},
  {id:'disagreement',query:'How do I prefer a team to handle differences of opinion?',required:['disagreement'],allowed:['disagreement'],semanticTarget:true},
  {id:'bread',query:'sourdough starter fermentation',required:['bread'],allowed:['bread']},
  {id:'unrelated',query:'Explain exoplanet spectroscopy instrumentation.',required:[],allowed:[]},
  {id:'foreign-only',query:'Zephyr Observatory spectrograph calibration',required:[],allowed:[]},
];
export const retrievalGate={minimumRecall:.9,minimumSemanticGain:3,maximumNegativeMatches:0,unexpectedMatchesMustNotIncrease:true} as const;

/** Initial holdout, declared before its vectors. It rejected the first policy
 * and is now retained as a known regression set, not independent validation. */
export const retrievalHoldoutCases:RetrievalCase[]=[
  {id:'holdout-evenings',query:'What have I saved about preserving evenings for the people closest to me?',required:['family'],allowed:['family','boundaries'],semanticTarget:true},
  {id:'holdout-portability-ko',query:'남의 서비스에 갇히지 않고 내 파일을 계속 갖고 있으려면?',required:['export'],allowed:tools,semanticTarget:true},
  {id:'holdout-sketching',query:'Which saved thought connects steady sketching with consistency rather than bursts of inspiration?',required:['practice'],allowed:['practice','pottery'],semanticTarget:true},
  {id:'holdout-disagreement-ko',query:'모두가 동의하는 척하기보다 의견 차이를 먼저 드러내는 태도는?',required:['disagreement'],allowed:['disagreement'],semanticTarget:true},
  {id:'holdout-reflection',query:'What reflection mentioned feeling lighter after removing headphones?',required:['walk'],allowed:['walk','rest'],semanticTarget:true},
  {id:'holdout-audio-ko',query:'녹음 내용을 고친 뒤에는 어떤 짧은 미술 수업을 원한다고 했지?',required:['audio'],allowed:['audio','practice','pottery','trials','trial-copy'],semanticTarget:true},
  {id:'holdout-unrelated',query:'Locate my notes on spacecraft antenna impedance.',required:[],allowed:[]},
  {id:'holdout-unrelated-ko',query:'양자 역학의 터널링 확률 계산',required:[],allowed:[]},
];

/** Fresh validation for the abstention revision; the prior holdout is now a
 * known regression set, not independent evidence for the new policy. */
export const retrievalValidationCases:RetrievalCase[]=[
  {id:'validation-family',query:"Is there a memory about disconnecting from work when I am at home with relatives?",required:['family'],allowed:['family','boundaries'],semanticTarget:true},
  {id:'validation-trial-ko',query:'새 취미에 큰돈을 쓰기 전에 해 볼 작은 시험은?',required:['trials','trial-copy','audio'],allowed:[...trials,'pottery'],semanticTarget:true},
  {id:'validation-walk',query:'Which reflection connected silence on a riverside stroll with clearer thinking?',required:['walk'],allowed:space,semanticTarget:true},
  {id:'validation-export-ko',query:'프로그램을 바꿔도 읽을 수 있는 형태로 내 자료를 꺼내는 것',required:['export'],allowed:tools,semanticTarget:true},
  {id:'validation-bread',query:'Find the saved recipe involving fermented dough and a starter culture.',required:['bread'],allowed:['bread']},
  {id:'validation-practice-ko',query:'의욕이 생길 때만 기다리지 않고 자주 그림을 그리는 습관',required:['practice'],allowed:['practice','pottery'],semanticTarget:true},
  {id:'validation-unrelated',query:'Have I saved anything about superconducting magnets in particle accelerators?',required:[],allowed:[]},
  {id:'validation-unrelated-ko',query:'내 기록에서 심해 열수 분출공의 화학 반응을 찾아줘',required:[],allowed:[]},
];
