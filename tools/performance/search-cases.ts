/** Synthetic search contract. Ordinals are newest-first fixture rows, never
 * real account identities. Cases exercise the existing literal/lexical rules. */
export const searchCases=[
  {label:'common_english',query:'walking',contains:()=>true},
  {label:'rare_english',query:'marmalade',contains:(n:number,count:number)=>n===count},
  {label:'no_result',query:'unfindablezx',contains:()=>false},
  {label:'multiword_english',query:'experiments walking',contains:()=>true},
  {label:'common_korean',query:'여백',contains:(n:number)=>n%7===0},
  {label:'partial_korean',query:'백',contains:(n:number)=>n%7===0},
  {label:'multiword_korean',query:'생각 여백',contains:(n:number)=>n%7===0},
  {label:'rare_korean',query:'한낮의별빛',contains:(n:number,count:number)=>n===count},
  {label:'literal_percent',query:'%',contains:(n:number,count:number)=>n===count},
  {label:'literal_underscore',query:'_',contains:(n:number,count:number)=>n===count},
  {label:'literal_escape',query:'!',contains:(n:number,count:number)=>n===count},
  {label:'reflection_only',query:'important',contains:(n:number)=>n%4===0&&n!==4},
  {label:'rare_reflection',query:'rare reflection mark',contains:(n:number)=>n===8},
  {label:'link_body',query:'article',contains:(n:number)=>n%5===0&&n!==5&&n!==10&&n%25!==0},
  {label:'image_text',query:'정원',contains:(n:number)=>n%25===0},
  {label:'corrected_audio',query:'garden',contains:(n:number)=>n===5||n===10},
  {label:'corrected_korean',query:'고친 목소리',contains:(n:number)=>n===5||n===10},
  {label:'superseded_audio',query:'Superseded',contains:()=>false},
  {label:'private_storage_locator',query:'private-object',contains:()=>false},
  {label:'skipped_reflection',query:'SKIPPED_SENTINEL',contains:()=>false},
] as const;
