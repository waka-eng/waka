import {OWNER_BEING} from '../character/body';
import {restPose} from '../character/raster';
import {rampFromCss} from '../canvas/palette';
export type ArtifactAppearance='dark'|'light';
export type ArtifactFormat='square'|'portrait';
export interface PrincipleArtifactContent {
  items:Array<{text:string;label?:string;date?:string}>;
  name:string;appearance:ArtifactAppearance;format:ArtifactFormat;
  /**
   * WHAT IS BEING SHARED, because each is held differently. Founder,
   * 2026-10-15: "sharing an inspiration, sharing a top of mind, sharing a
   * principle should have slightly different design — right now this treats
   * all three equally." A kept thing is a NOTE the creature holds up; what is
   * on your mind is a THOUGHT bubble rising from its head; a principle is set
   * in the SKY above it, on the star trails of the principles page, with
   * nothing around it. Absent means a principle, the card's first kind.
   */
  kind?:'inspiration'|'topOfMind'|'principle';
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
  /**
   * A PHOTO ABOVE THE WORDS, for a save that is a picture. Decoded by the
   * caller so this stays a pure drawing step; absent for principles and the
   * top of mind, which are words only. Cropped to fill its band, never
   * stretched, because a squashed photo of someone's own moment is the one
   * thing on the card they would notice first.
   */
  photo?:CanvasImageSource&{width:number;height:number}|null;
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

/** THE MARK, and the only brand on the card.
 *
 * Founder, 2026-10-15, on sharing: "look at how Strava and other products
 * really make that sharing experience nice." What every one of those cards
 * has in common is a small, quiet mark in a corner — never a logo across the
 * middle — and it is the whole reason a stranger can find the product that
 * made the thing they are looking at. One word, in the muted ink, where a
 * signature would go.
 */
const SHARE_MARK='WAKA';

/** A seeded Park–Miller stream, so the same card always draws the same sky. */
function seeded(seed:number):()=>number{
  return()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
}

/** The preview and exported file use these same pixels. No evidence, ids or
 * private metadata are accepted by the renderer. Principles, saves and the
 * top of mind all draw here, so the three cards are one family. */
export async function renderShareCard(content:PrincipleArtifactContent):Promise<{blob:Blob;width:number;height:number;fallbackFont:boolean}>{
  if(!content.items.length||content.items.length>3||content.items.some(item=>!item.text.trim()))throw new ArtifactLayoutError('empty');
  if(content.items.some(item=>item.text.length>2000)||content.name.length>100)throw new ArtifactLayoutError('too_long');
  if(content.proof&&content.proof.length>160)throw new ArtifactLayoutError('too_long');
  const words=content.items.map(item=>item.text).join('\n');
  let fallbackFont=true,timer:ReturnType<typeof setTimeout>|undefined;
  try{
    /* JOST FIRST, PRETENDARD BEHIND IT (founder, 2026-10-15, approved): the
       app's own voice for Latin, and Korean falling through to Pretendard
       glyph by glyph — the same stack the app sets everywhere — so a card
       finally looks like WAKA rather than like a generic quote. Both are
       asked for; the card is only "on the device's font" when neither came. */
    if(document.fonts){
      const wanted=Promise.all([document.fonts.load('400 64px Jost',words),document.fonts.load('300 64px Jost',words),document.fonts.load('400 64px Pretendard',words)]);
      const loaded=await Promise.race([wanted,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),3000);})]);
      fallbackFont=!loaded||loaded.every(faces=>!faces.length);
    }
  }catch{/* A device font still renders the same complete preview/export. */}
  finally{clearTimeout(timer);}
  const family=fallbackFont?'Arial, "Apple SD Gothic Neo", sans-serif':'Jost, Pretendard, "Apple SD Gothic Neo", sans-serif';
  /* A principle stands alone in the sky, in Jost's light weight; everything
     held in the creature's hands is the regular one. */
  const kind=content.kind??'principle';
  const wordWeight=kind==='principle'?300:400;

  /* ═══ THE CREATURE SAYS IT ═══════════════════════════════════════════
     Founder, 2026-10-15: "for the sharing the inspiration too, I feel like
     the character should be a big part of it. So really make it aesthetic
     and beautiful and something I can't bear but share."

     The card is the home screen's best moment, kept: the creature in its
     own light, and what you shared above it — a note it holds up, a
     thought rising from its head, or a principle set in the sky (see
     `kind`). A quote on a frame is a thing anyone can make; your words
     being held up by the one who has been keeping them is the thing only
     this product makes, and it is the part a stranger stops on. The words
     are still the largest thing on the card and still yours, word for
     word. */
  const width=1080,height=content.format==='portrait'?1350:1080,margin=84;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new ArtifactLayoutError('unavailable');
  const dark=content.appearance==='dark';
  const ink={night0:'#0d1322',night1:'#05080f',paper0:'#f7f2e8',paper1:'#ede5d6',bubbleDark:'#e9dfcc',bubbleLight:'#fffdf8',onBubble:'#151821',muted:dark?'#a9a397':'#6c665b',mark:dark?'#8e887d':'#8b8476',glow:'255,242,220'};

  /* GROUND: a night that is a little lighter at the top, or warm paper. */
  const ground=ctx.createLinearGradient(0,0,0,height);
  ground.addColorStop(0,dark?ink.night0:ink.paper0);ground.addColorStop(1,dark?ink.night1:ink.paper1);
  ctx.fillStyle=ground;ctx.fillRect(0,0,width,height);

  /* THE CREATURE'S PLACE, measured before the words so they fit above it. */
  const being=Math.round(content.format==='portrait'?250:200);
  let beingTop=height-margin-64-being;
  const beingLeft=(width-being)/2;
  /* DUST, on the night only: the faint specks the home screen's sky is made
     of, seeded so the same card always has the same sky. */
  if(dark){
    const rand=seeded(7);
    for(let i=0;i<46;i++){
      const dx=rand()*width,dy=rand()*height,dr=0.8+rand()*1.8;
      ctx.fillStyle=`rgba(${ink.glow},${0.05+rand()*0.16})`;ctx.beginPath();ctx.arc(dx,dy,dr,0,Math.PI*2);ctx.fill();
    }
  }

  ctx.textBaseline='top';
  /* THE LINE ABOVE EVERYTHING: when it was kept, or what this is. */
  const proofSpace=content.proof?72:0;
  if(content.proof){
    ctx.font=`400 30px ${family}`;ctx.fillStyle=ink.muted;
    if(ctx.measureText(content.proof).width>width-margin*2)throw new ArtifactLayoutError('too_long');
    ctx.fillText(content.proof,margin,margin);
  }

  /* THE WORDS' BOX — the note, the thought, or the open sky a principle
     stands in: from under the proof line to a gap above the creature (room
     for the thought's rising rounds). Everything the person chose goes
     inside it. */
  const bubbleGap=64;
  const bubbleTop=margin+proofSpace;
  const bubbleBottomMax=beingTop-bubbleGap;
  const bubbleW=width-margin*2,pad=56,textW=bubbleW-pad*2;
  const photo=content.photo&&content.photo.width>0&&content.photo.height>0?content.photo:null;
  const photoH=photo?Math.round(Math.min((bubbleBottomMax-bubbleTop)*0.42,textW*photo.height/photo.width)):0;
  const photoSpace=photo?photoH+36:0;
  const available=bubbleBottomMax-bubbleTop-pad*2-photoSpace;
  let selected:{size:number;height:number;items:Array<{lines:string[];label?:string;date?:string}>}|null=null;
  for(let size=66;size>=36;size-=2){
    ctx.font=`${wordWeight} ${size}px ${family}`;
    const items=content.items.map(item=>({...item,lines:wrapArtifactText(item.text,textW,value=>ctx.measureText(value).width)}));
    const total=items.reduce((sum,item)=>sum+item.lines.length*size*1.32+(item.label||item.date?50:0),0)+(items.length-1)*44;
    if(total<=available){selected={size,height:total,items};break;}
  }
  if(!selected)throw new ArtifactLayoutError('too_long');
  const bubbleH=pad*2+photoSpace+selected.height;
  /* THE BUBBLE AND THE ONE SAYING IT MOVE AS ONE, into the middle of the
     card. Anchored to the foot, a short sentence on the tall card left half
     the picture empty above it; the pair is lifted by a little under half
     the room left over, so it sits just below centre, where the eye rests. */
  const free=Math.max(0,bubbleBottomMax-bubbleH-bubbleTop);
  const lift=Math.round(free*0.45);
  beingTop-=lift;
  const bubbleY=bubbleBottomMax-bubbleH-lift;
  /* its light, laid on the ground before the bubble and the body */
  const glow=ctx.createRadialGradient(width/2,beingTop+being*0.55,being*0.2,width/2,beingTop+being*0.55,being*2.1);
  glow.addColorStop(0,`rgba(${ink.glow},${dark?0.34:0.55})`);glow.addColorStop(0.45,`rgba(${ink.glow},${dark?0.1:0.2})`);glow.addColorStop(1,`rgba(${ink.glow},0)`);
  ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
  const x0=margin,y0=bubbleY,x1=margin+bubbleW,y1=bubbleY+bubbleH,cx=width/2;
  const roundRect=(left:number,top:number,right:number,bottom:number,radius:number)=>{
    ctx.moveTo(left+radius,top);ctx.lineTo(right-radius,top);ctx.quadraticCurveTo(right,top,right,top+radius);ctx.lineTo(right,bottom-radius);
    ctx.quadraticCurveTo(right,bottom,right-radius,bottom);ctx.lineTo(left+radius,bottom);ctx.quadraticCurveTo(left,bottom,left,bottom-radius);
    ctx.lineTo(left,top+radius);ctx.quadraticCurveTo(left,top,left+radius,top);
  };
  /* The words' ink: dark on anything the creature holds, the page's own ink
     when they stand in the sky. */
  let wordInk=ink.onBubble,labelInk='rgba(21,24,33,0.55)',ruleInk='rgba(21,24,33,0.14)',centred=false;

  ctx.save();
  if(kind==='principle'){
    /* ═══ A PRINCIPLE: IN THE SKY ═════════════════════════════════════
       No container. The statement stands in the open above the creature,
       on the same long exposure the principles page opens with — arcs of
       light around one still pole — because a principle is the thing that
       did not move while everything else did. */
    const rand=seeded(11);
    /* The pole sits well above the card, so only the wide, calm arcs cross
       it: with the pole on the card, tight rings crowded behind the proof
       line. */
    const pole={x:cx,y:-height*0.35},reach=Math.hypot(cx,height*1.35);
    ctx.lineCap='round';
    for(let i=0;i<150;i++){
      const radius=height*0.38+rand()*(reach-height*0.38),start=Math.PI*(0.08+rand()*0.84),bright=0.25+rand()*0.75,thick=rand()<0.08?2.2:1.2;
      const falloff=1-Math.pow(Math.max(0,(radius-height*0.38)/(reach-height*0.38)),2)*0.6;
      ctx.strokeStyle=dark?`rgba(${ink.glow},${0.32*bright*falloff})`:`rgba(120,100,70,${0.18*bright*falloff})`;
      ctx.lineWidth=thick;ctx.beginPath();ctx.arc(pole.x,pole.y,radius,start,start+0.32);ctx.stroke();
    }
    wordInk=dark?'#f2ece1':'#1d1f26';labelInk=ink.muted;ruleInk=dark?'rgba(242,236,225,0.2)':'rgba(21,24,33,0.14)';centred=true;
  }else if(kind==='topOfMind'){
    /* ═══ WHAT IS ON YOUR MIND: A THOUGHT ═════════════════════════════
       A pillowy bubble with no tail, and three small rounds rising from
       the creature's head to it — the bubble a thought is drawn in, where
       speech gets a point. */
    ctx.shadowColor=dark?`rgba(${ink.glow},0.28)`:'rgba(40,32,20,0.14)';ctx.shadowBlur=dark?60:40;ctx.shadowOffsetY=dark?0:10;
    ctx.fillStyle=dark?ink.bubbleDark:ink.bubbleLight;
    ctx.beginPath();roundRect(x0,y0,x1,y1,Math.min(84,bubbleH/2));
    const rise:[number,number,number][]=[[cx-46,y1+22,16],[cx-28,y1+46,10],[cx-14,y1+64,6]];
    for(const [bx,by,br] of rise){ctx.moveTo(bx+br,by);ctx.arc(bx,by,br,0,Math.PI*2);}
    ctx.fill();
  }else{
    /* ═══ SOMETHING YOU KEPT: A NOTE, HELD UP ═════════════════════════
       Paper rather than speech — a thing you put away, now taken out and
       shown — so it sits a little crooked, lifted on a soft shadow, with a
       strip of tape at its top. The words and photo turn with it. */
    ctx.translate(cx,(y0+y1)/2);ctx.rotate(-0.026);ctx.translate(-cx,-(y0+y1)/2);
    ctx.save();
    ctx.shadowColor=dark?'rgba(0,0,0,0.45)':'rgba(40,32,20,0.18)';ctx.shadowBlur=36;ctx.shadowOffsetY=16;
    ctx.fillStyle=dark?'#efe6d4':'#fffdf8';
    ctx.beginPath();roundRect(x0,y0,x1,y1,16);ctx.fill();
    ctx.restore();
    ctx.save();ctx.translate(cx,y0+2);ctx.rotate(0.05);
    ctx.fillStyle=dark?'rgba(255,242,220,0.5)':'rgba(214,196,160,0.45)';ctx.fillRect(-70,-18,140,36);
    ctx.restore();
  }
  ctx.shadowColor='transparent';

  let y=bubbleY+pad;
  if(photo){
    const band={x:margin+pad,y,w:textW,h:photoH};
    const scale=Math.max(band.w/photo.width,band.h/photo.height);
    const sw=band.w/scale,sh=band.h/scale,sx=(photo.width-sw)/2,sy=(photo.height-sh)/2;
    ctx.save();ctx.beginPath();
    const pr=kind==='inspiration'?8:20;ctx.moveTo(band.x+pr,band.y);ctx.arcTo(band.x+band.w,band.y,band.x+band.w,band.y+band.h,pr);ctx.arcTo(band.x+band.w,band.y+band.h,band.x,band.y+band.h,pr);ctx.arcTo(band.x,band.y+band.h,band.x,band.y,pr);ctx.arcTo(band.x,band.y,band.x+band.w,band.y,pr);ctx.closePath();ctx.clip();
    ctx.drawImage(photo,sx,sy,sw,sh,band.x,band.y,band.w,band.h);ctx.restore();
    y+=photoSpace;
  }
  const lineX=(text:string)=>centred?(width-ctx.measureText(text).width)/2:margin+pad;
  for(const [index,item] of selected.items.entries()){
    if(index){ctx.strokeStyle=ruleInk;ctx.lineWidth=2;ctx.beginPath();
      if(centred){ctx.moveTo(cx-60,y-22);ctx.lineTo(cx+60,y-22);}else{ctx.moveTo(margin+pad,y-22);ctx.lineTo(margin+bubbleW-pad,y-22);}
      ctx.stroke();}
    if(item.label||item.date){
      ctx.font=`400 26px ${family}`;ctx.fillStyle=labelInk;
      const label=[item.label,item.date].filter(Boolean).join(' · ');
      if(ctx.measureText(label).width>textW)throw new ArtifactLayoutError('too_long');
      ctx.fillText(label,lineX(label),y);y+=50;
    }
    ctx.font=`${wordWeight} ${selected.size}px ${family}`;ctx.fillStyle=wordInk;
    for(const line of item.lines){ctx.fillText(line,lineX(line),y);y+=selected.size*1.32;}
    y+=44;
  }
  ctx.restore();

  /* THE CREATURE, in its own light, standing on a soft shadow so it is on
     the ground of the card rather than pasted over it. */
  ctx.save();ctx.fillStyle=dark?'rgba(0,0,0,0.35)':'rgba(60,48,30,0.16)';
  ctx.beginPath();ctx.ellipse(width/2,beingTop+being*0.93,being*0.42,being*0.07,0,0,Math.PI*2);ctx.fill();ctx.restore();
  ctx.save();ctx.translate(beingLeft,beingTop);
  /* dpr 1: the card is drawn in its own pixels, at the export's size. */
  restPose(ctx,being,rampFromCss(document.documentElement),OWNER_BEING,1,1);
  ctx.restore();

  /* NAME AND MARK, on one quiet line at the foot. */
  ctx.font=`400 28px ${family}`;ctx.fillStyle=ink.muted;
  if(content.name){
    if(ctx.measureText(content.name).width>width/2)throw new ArtifactLayoutError('too_long');
    ctx.fillText(content.name,margin,height-margin-28);
  }
  ctx.font=`500 24px ${family}`;ctx.fillStyle=ink.mark;
  const markWidth=ctx.measureText(SHARE_MARK).width;
  ctx.fillText(SHARE_MARK,width-margin-markWidth,height-margin-24);

  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new ArtifactLayoutError('unavailable')),'image/png'));
  return {blob,width,height,fallbackFont};
}
