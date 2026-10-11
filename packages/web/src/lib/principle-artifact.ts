export type ArtifactAppearance='dark'|'light';
export type ArtifactFormat='square'|'portrait';
export interface PrincipleArtifactContent {
  items:Array<{text:string;label?:string;date?:string}>;
  name:string;appearance:ArtifactAppearance;format:ArtifactFormat;
  /**
   * THE PROOF, AND IT IS THE HEADLINE RATHER THAN THE FOOTNOTE.
   *
   * Founder: "how we can make the principal page something that people would
   * want to like share on their social media and stuff."
   *
   * The thing people actually post about themselves is never the sentiment —
   * it is the EVIDENCE that the sentiment was earned. Spotify Wrapped is a
   * stat; the songs are only the proof of it. A principle posted alone is a
   * fortune cookie and reads as one, because a stranger has no way to tell it
   * from something typed that morning. "847 things kept over seven months,
   * and these are what stayed" is the half a stranger cannot fake, and it is
   * the half that makes them wonder what theirs would say.
   *
   * So it sits ABOVE the statements, in the muted ink, at a size that reads
   * before them — the frame a person is posting, with the content inside it.
   * It carries no ids and no evidence text: see the note below, which this
   * does not relax.
   */
  proof?:string;
}
export class ArtifactLayoutError extends Error {
  constructor(readonly code:'empty'|'too_long'|'unavailable'){super(code);}
}

/** Wrap complete graphemes and explicit paragraphs without clipping words. */
export function wrapArtifactText(text:string,maxWidth:number,measure:(value:string)=>number):string[]{
  const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
  const lines:string[]=[];
  for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
    let line='';
    for(const word of paragraph.split(/(\s+)/)){
      if(!word)continue;
      if(measure(line+word)<=maxWidth){line+=word;continue;}
      if(line.trim()){lines.push(line.trimEnd());line='';}
      if(!word.trim())continue;
      const characters=segmenter?Array.from(segmenter.segment(word),part=>part.segment):Array.from(word);
      for(const character of characters){
        if(measure(character)>maxWidth)throw new ArtifactLayoutError('too_long');
        if(line&&measure(line+character)>maxWidth){lines.push(line);line='';}
        line+=character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** The preview and exported file use these same pixels. No evidence, ids or
 * private metadata are accepted by the renderer. */
export async function renderPrincipleArtifact(content:PrincipleArtifactContent):Promise<{blob:Blob;width:number;height:number;fallbackFont:boolean}>{
  if(!content.items.length||content.items.length>3||content.items.some(item=>!item.text.trim()))throw new ArtifactLayoutError('empty');
  if(content.items.some(item=>item.text.length>2000)||content.name.length>100)throw new ArtifactLayoutError('too_long');
  const words=content.items.map(item=>item.text).join('\n');
  let fallbackFont=true,timer:ReturnType<typeof setTimeout>|undefined;
  try{
    if(document.fonts){const loaded=await Promise.race([document.fonts.load('400 64px Pretendard',words),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),3000);})]);fallbackFont=!loaded?.length;}
  }catch{/* A device font still renders the same complete preview/export. */}
  finally{clearTimeout(timer);}
  const width=1080,height=content.format==='portrait'?1350:1080,padding=96;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new ArtifactLayoutError('unavailable');
  const family=fallbackFont?'Arial, "Apple SD Gothic Neo", sans-serif':'Pretendard, sans-serif';
  if(content.proof&&content.proof.length>160)throw new ArtifactLayoutError('too_long');
  /* The proof's own band, reserved before the statements are fitted so they
     are never sized into space it is about to take. */
  const proofSpace=content.proof?96:0;
  const maxWidth=width-padding*2,nameSpace=content.name?92:0,available=height-padding*2-nameSpace-proofSpace;
  let selected:{size:number;height:number;items:Array<{lines:string[];label?:string;date?:string}>}|null=null;
  for(let size=72;size>=44;size-=2){
    ctx.font=`400 ${size}px ${family}`;
    const items=content.items.map(item=>({...item,lines:wrapArtifactText(item.text,maxWidth,value=>ctx.measureText(value).width)}));
    const total=items.reduce((sum,item)=>sum+item.lines.length*size*1.4+(item.label||item.date?56:0),0)+(items.length-1)*48;
    if(total<=available){selected={size,height:total,items};break;}
  }
  if(!selected)throw new ArtifactLayoutError('too_long');
  const colors=content.appearance==='dark'?{background:'#0b0e14',text:'#e8edf4',muted:'#adb3bb',edge:'#343943'}:
    {background:'#f4f0e8',text:'#18202b',muted:'#5e6269',edge:'#d5cfc4'};
  ctx.fillStyle=colors.background;ctx.fillRect(0,0,width,height);
  ctx.strokeStyle=colors.edge;ctx.lineWidth=2;ctx.strokeRect(40,40,width-80,height-80);
  ctx.textBaseline='top';
  if(content.proof){
    ctx.font=`400 34px ${family}`;ctx.fillStyle=colors.muted;
    if(ctx.measureText(content.proof).width>maxWidth)throw new ArtifactLayoutError('too_long');
    ctx.fillText(content.proof,padding,padding);
  }
  let y=padding+proofSpace+(available-selected.height)/2;
  for(const [index,item] of selected.items.entries()){
    if(index){ctx.strokeStyle=colors.edge;ctx.beginPath();ctx.moveTo(padding,y-24);ctx.lineTo(width-padding,y-24);ctx.stroke();}
    if(item.label||item.date){
      ctx.font=`400 28px ${family}`;ctx.fillStyle=colors.muted;
      const label=[item.label,item.date].filter(Boolean).join(' · ');
      if(ctx.measureText(label).width>maxWidth)throw new ArtifactLayoutError('too_long');
      ctx.fillText(label,padding,y);y+=56;
    }
    ctx.font=`400 ${selected.size}px ${family}`;ctx.fillStyle=colors.text;
    for(const line of item.lines){ctx.fillText(line,padding,y);y+=selected.size*1.4;}
    y+=48;
  }
  if(content.name){
    ctx.font=`400 28px ${family}`;ctx.fillStyle=colors.muted;
    if(ctx.measureText(content.name).width>maxWidth)throw new ArtifactLayoutError('too_long');
    ctx.fillText(content.name,padding,height-padding-28);
  }
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new ArtifactLayoutError('unavailable')),'image/png'));
  return {blob,width,height,fallbackFont};
}
