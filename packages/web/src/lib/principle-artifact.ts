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
  /**
   * THE LINE THE HOME BUBBLE OPENS WITH ("This is what's on your mind right
   * now."), for the top of mind only. Founder, 2026-10-16: "I want the share
   * it experience's speech bubble to look exactly like what I'm seeing in my
   * main screen, except just remove let's chat about it and share it."
   */
  frame?:string;
}
/** WHERE THE WORDS SIT, in card pixels (the card is 1080 wide), so the share
 * sheet can put an editable copy of them exactly over the bubble: founder,
 * 2026-10-16, "the user should be able to edit wording in the speech bubble
 * directly rather than having the edit wording thing". */
export interface ShareCardLayout {
  width:number;height:number;
  bubble:{x:number;y:number;w:number;h:number;radius:number;fill:string};
  text:{x:number;y:number;w:number;size:number;leading:number;weight:number;family:string;ink:string;align:'left'|'center'};
  /** The box an editable copy of the words should fill: the part of the
   * bubble the words occupy (under the frame line, if there is one), with the
   * padding that puts each line where the drawn one is. */
  edit:{x:number;y:number;w:number;h:number;padTop:number;padX:number;padBottom:number;radiusTop:number;radiusBottom:number;
    /** The turn the bubble is drawn at (radians; the kept note sits a little
     * crooked) and the card point it turns about, so the editor turns with it. */
    rotation:number;origin:{x:number;y:number}};
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

/** The share card's words are this much larger than first measured
 * (founder, 2026-10-18: "make the font very slightly bigger"). */
const WORD_SCALE=13.75/13;
/** The top of mind's words on the home measure: 13px on 18.85px lines on the
 * home screen, here WORD_SCALE larger. */
const HOME_WORD_SIZE=13*WORD_SCALE,HOME_WORD_LINE=18.85*WORD_SCALE;

/** How crooked a kept note is held up, in radians (see the note's drawing). */
const NOTE_TILT=-0.026;

/** A seeded Park–Miller stream, so the same card always draws the same sky. */
function seeded(seed:number):()=>number{
  return()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
}

/** THE SIZES A HELD CARD (a note, a thought) OR A PRINCIPLE TRIES, largest
 * first, in steps of 2 and always ending on the floor: held 51 → 28,
 * principle 70 → 36. The tops carry the ~6% bump (founder, 2026-10-18, "very
 * slightly bigger"); the floors are the ones before it, so every card that
 * fitted before the bump still fits. */
export function fitSizes(kind:'held'|'principle'):number[]{
  const [top,floor]=kind==='held'?[51,28]:[70,36];
  const sizes:number[]=[];
  for(let size=top;size>floor;size-=2)sizes.push(size);
  sizes.push(floor);
  return sizes;
}

/** THE GRAIN, BUILT ONCE. ±GRAIN_SPAN on every channel, seeded, as a small
 * tile kept for the life of the page: the card redraws a beat after each
 * keystroke, and reading and writing every pixel of a 1080 card each time
 * was the slowest thing in the draw. The tile holds `n + GRAIN_SPAN` (never
 * negative); it is ADDED ('lighter') and the constant GRAIN_SPAN is then
 * taken back off ('difference' against it), which is `base + n` wherever
 * the result stays in range — the same grain, composited by the GPU. */
const GRAIN_SPAN=7,GRAIN_TILE=256;
let grainTile:HTMLCanvasElement|null|undefined;
export function grainTileCanvas():HTMLCanvasElement|null{
  if(grainTile!==undefined)return grainTile;
  try{
    const tile=document.createElement('canvas');tile.width=GRAIN_TILE;tile.height=GRAIN_TILE;
    const tctx=tile.getContext('2d');
    if(!tctx){grainTile=null;return null;}
    const image=tctx.createImageData(GRAIN_TILE,GRAIN_TILE),data=image.data,rand=seeded(29);
    for(let i=0;i<data.length;i+=4){const v=Math.round((rand()-0.5)*GRAIN_SPAN*2)+GRAIN_SPAN;data[i]=v;data[i+1]=v;data[i+2]=v;data[i+3]=255;}
    tctx.putImageData(image,0,0);
    grainTile=tile;
  }catch{grainTile=null;}
  return grainTile;
}
function laySignedGrain(ctx:CanvasRenderingContext2D,width:number,height:number){
  const tile=grainTileCanvas();
  const grainFill=tile?ctx.createPattern(tile,'repeat'):null;
  if(!grainFill)return;/* no tile: the card keeps its clean surface */
  ctx.save();
  ctx.globalCompositeOperation='lighter';ctx.fillStyle=grainFill;ctx.fillRect(0,0,width,height);
  ctx.globalCompositeOperation='difference';ctx.fillStyle=`rgb(${GRAIN_SPAN},${GRAIN_SPAN},${GRAIN_SPAN})`;ctx.fillRect(0,0,width,height);
  ctx.restore();
}

/** The preview and exported file use these same pixels. No evidence, ids or
 * private metadata are accepted by the renderer. Principles, saves and the
 * top of mind all draw here, so the three cards are one family. */
export async function renderShareCard(content:PrincipleArtifactContent):Promise<{blob:Blob;width:number;height:number;fallbackFont:boolean;layout:ShareCardLayout}>{
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
  /* The top of mind sits on the home screen's own night (sampled: 7,13,22 at
     the top to 2,4,9 at the edges); the other cards keep theirs. */
  const homeNight=content.kind==='topOfMind'&&dark;
  ground.addColorStop(0,homeNight?'#070d16':dark?ink.night0:ink.paper0);ground.addColorStop(1,homeNight?'#02040a':dark?ink.night1:ink.paper1);
  ctx.fillStyle=ground;ctx.fillRect(0,0,width,height);

  /* THE CREATURE'S PLACE, measured before the words so they fit above it. */
  let being=Math.round(content.format==='portrait'?250:200);
  let beingTop=height-margin-64-being;
  let beingLeft=(width-being)/2;
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
  /* ═══ SMALLER WORDS IN MORE AIR, FOR WHAT THE CREATURE HOLDS ══════════
     Founder, 2026-10-16, on the share card: the fonts were much bigger than
     hoped. The fit used to start at 66px and take the largest size that
     filled the bubble, so a sentence was always set as loud as the box
     allowed. A thought or a kept note now tops out at 48px with more
     leading, in a narrower bubble with deeper padding — the words held, not
     shouted. A principle, which stands alone in the sky, keeps its scale. */
  const held=kind!=='principle';
  /* ═══ THE TOP OF MIND IS SAID THE WAY THE HOME SCREEN SAYS IT ═════════
     Founder, 2026-10-16: "I want the share it experience's speech bubble to
     look exactly like what I'm seeing in my main screen, except just remove
     let's chat about it and share it." So this bubble is the home one at
     card scale, measured off it (`.jar-char-bubble-body` in claims.css):
     sized to its words rather than the card, the frame line on top at 12/13
     of the words, everything centred, 12/16/10 padding, 20/18 corners, the
     warm paper fill and its three soft halos, and the small rounded tail
     pointing down at the creature. `s` is the home bubble's px → card px. */
  const spoken=kind==='topOfMind';
  const frame=spoken?(content.frame??'').trim():'';
  const inset=held?112:margin;
  const pad=held?64:56;
  let bubbleW=width-inset*2;const textW=bubbleW-pad*2;
  /* ═══ VERY SLIGHTLY BIGGER WORDS ═════════════════════════════════════
     Founder, 2026-10-18: "make the font very slightly bigger." Every kind's
     words are WORD_SCALE (~6%) larger where they have room: the held and
     principle fits START that much higher (`fitSizes`), and the top of
     mind's home measure is 13.75px on lines scaled with it (below). The
     floors do not move, so nothing that fitted before stops fitting. */
  const leading=spoken?HOME_WORD_LINE/HOME_WORD_SIZE:held?1.42:1.32;
  const photo=content.photo&&content.photo.width>0&&content.photo.height>0?content.photo:null;
  const photoH=photo?Math.round(Math.min((bubbleBottomMax-bubbleTop)*0.42,textW*photo.height/photo.width)):0;
  const photoSpace=photo?photoH+36:0;
  const available=bubbleBottomMax-bubbleTop-pad*2-photoSpace;
  let selected:{size:number;height:number;items:Array<{lines:string[];label?:string;date?:string}>}|null=null;
  let said:{s:number;padTop:number;padBottom:number;padX:number;frameSize:number;frameH:number;gap:number}|null=null;
  if(spoken){
    /* ═══ THE HOME SCREEN, SCALED — NOT RE-DESIGNED ═══════════════════
       Founder, 2026-10-16, of the first attempt: "definitely not the same
       … I want the exact ratio of the character and the speech bubble,
       like just copy and paste exactly what it is in there." Measured off
       the live home screen at 1:1 (CSS px): the bubble is 352 wide, its
       words wrap at 320 in 13px on 18.85px lines under a 12px frame line
       18px tall, padding 12/16/10, a 6px gap; the tail's tip is 6 below
       the bubble; the creature's body begins 26 below that tip and is 107
       wide. One factor `k` carries every one of those onto the card, so
       the line breaks, the bubble's proportions and the creature's size
       beside it are the home screen's, only larger. */
    /* The words are WORD_SCALE larger than the home screen's 13px; the
       bubble is sized to them, as on the home screen, so it grows with them
       (taller, or wider up to its 352), and the creature keeps the home
       screen's size beside a bubble of the same width. */
    const H={bubbleMax:352,wrap:320,size:HOME_WORD_SIZE,line:HOME_WORD_LINE,frame:12,frameLine:18,padTop:12,padX:16,padBottom:10,gap:6,tail:6,toBody:26,body:107};
    ctx.font=`400 ${H.size}px ${family}`;
    const homeItems=content.items.map(item=>({...item,lines:wrapArtifactText(item.text,H.wrap,value=>ctx.measureText(value).width)}));
    const homeWidest=Math.max(...homeItems.flatMap(item=>item.lines.map(line=>ctx.measureText(line).width)));
    ctx.font=`400 ${H.frame}px ${family}`;
    const homeFrameW=frame?ctx.measureText(frame).width:0;
    const homeW=Math.min(H.bubbleMax,Math.ceil(Math.max(homeWidest,homeFrameW))+H.padX*2);
    const lineCount=homeItems.reduce((sum,item)=>sum+item.lines.length,0);
    const homeBubbleH=H.padTop+(frame?H.frameLine+H.gap:0)+lineCount*H.line+H.padBottom;
    /* The creature, in its drawing box: the body is ~0.855 of the box wide
       and its visible top ~0.17 of the box down (measured on this renderer). */
    const homeBeing=H.body/0.855;
    const homeGroupH=homeBubbleH+H.tail+H.toBody+homeBeing*0.8;
    const space={top:margin+proofSpace,bottom:height-margin-40};
    const k=Math.min(2.6,(width-margin*2)/homeW,(space.bottom-space.top)/homeGroupH);
    if(k<1.2)throw new ArtifactLayoutError('too_long');
    const size=H.size*k;
    selected={size,height:lineCount*H.line*k,items:homeItems};
    said={s:k,padTop:H.padTop*k,padBottom:H.padBottom*k,padX:H.padX*k,frameSize:H.frame*k,frameH:frame?H.frameLine*k:0,gap:H.gap*k};
    bubbleW=Math.round(homeW*k);
    being=Math.round(homeBeing*k);
    beingLeft=(width-being)/2;
  }else{
    for(const size of fitSizes(held?'held':'principle')){
      ctx.font=`${wordWeight} ${size}px ${family}`;
      const items=content.items.map(item=>({...item,lines:wrapArtifactText(item.text,textW,value=>ctx.measureText(value).width)}));
      const total=items.reduce((sum,item)=>sum+item.lines.length*size*leading+(item.label||item.date?50:0),0)+(items.length-1)*44;
      if(total<=available){selected={size,height:total,items};break;}
    }
  }
  if(!selected)throw new ArtifactLayoutError('too_long');
  const bubbleH=said?said.padTop+(frame?said.frameH+said.gap:0)+selected.height+said.padBottom:pad*2+photoSpace+selected.height;
  /* THE BUBBLE AND THE ONE SAYING IT MOVE AS ONE, into the middle of the
     card. Anchored to the foot, a short sentence on the tall card left half
     the picture empty above it; the pair is lifted by a little under half
     the room left over, so it sits just below centre, where the eye rests. */
  let bubbleY:number;
  if(said){
    /* The home group — bubble, tail, gap, creature — centred in the room
       between the date line and the mark. */
    const k=said.s,groupH=bubbleH+(6+26)*k+being*(0.8-0.17);
    const spaceTop=margin+proofSpace,spaceBottom=height-margin-40;
    bubbleY=Math.round(spaceTop+Math.max(0,(spaceBottom-spaceTop-groupH)/2));
    beingTop=Math.round(bubbleY+bubbleH+(6+26)*k-being*0.17);
  }else{
    const free=Math.max(0,bubbleBottomMax-bubbleH-bubbleTop);
    const lift=Math.round(free*0.45);
    beingTop-=lift;
    bubbleY=bubbleBottomMax-bubbleH-lift;
  }
  /* its light, laid on the ground before the bubble and the body */
  /* The home glow is tight: bright to about one body-width from the
     creature and gone by one and a half; the card used to spread it twice
     as far. */
  const glow=ctx.createRadialGradient(width/2,beingTop+being*0.55,being*0.2,width/2,beingTop+being*0.55,being*(said?1.35:2.1));
  /* The home halo, measured at matching points, is about twice the card's
     old one; the top of mind takes the home strength. */
  const glowCore=said&&dark?0.72:dark?0.34:0.55,glowMid=said&&dark?0.22:dark?0.1:0.2;
  glow.addColorStop(0,`rgba(${ink.glow},${glowCore})`);glow.addColorStop(0.45,`rgba(${ink.glow},${glowMid})`);glow.addColorStop(1,`rgba(${ink.glow},0)`);
  ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
  const bx0=said?Math.round((width-bubbleW)/2):inset;
  const x0=bx0,y0=bubbleY,x1=bx0+bubbleW,y1=bubbleY+bubbleH,cx=width/2;
  const SAID_FILL='#d7cdbb',SAID_INK='#11131a';
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
  }else if(said){
    /* ═══ WHAT IS ON YOUR MIND: SAID, AS ON THE HOME SCREEN ═══════════
       The body and its tail are one path, filled three times under the
       home bubble's three warm halos (12/34/76px at 0.2/0.1/0.05). */
    const s=said.s,r=Math.round(19*s),half=Math.round(9.2*s),tipY=y1+Math.round(7.5*s);
    const shape=()=>{ctx.beginPath();roundRect(x0,y0,x1,y1,r);
      ctx.moveTo(cx-half,y1-1);ctx.quadraticCurveTo(cx-2*s,tipY-1.5*s,cx,tipY);ctx.quadraticCurveTo(cx+2*s,tipY-1.5*s,cx+half,y1-1);ctx.closePath();};
    ctx.fillStyle=SAID_FILL;
    for(const [blur,alpha] of [[76,0.05],[34,0.1],[12,0.2]] as const){
      ctx.shadowColor=`rgba(${ink.glow},${alpha})`;ctx.shadowBlur=blur*s;shape();ctx.fill();
    }
    wordInk=SAID_INK;labelInk='rgba(17,19,26,0.6)';centred=true;
  }else{
    /* ═══ SOMETHING YOU KEPT: A NOTE, HELD UP ═════════════════════════
       Paper rather than speech — a thing you put away, now taken out and
       shown — so it sits a little crooked, lifted on a soft shadow, with a
       strip of tape at its top. The words and photo turn with it. */
    ctx.translate(cx,(y0+y1)/2);ctx.rotate(NOTE_TILT);ctx.translate(-cx,-(y0+y1)/2);
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

  let y=bubbleY+(said?said.padTop:pad);
  if(said&&frame){
    ctx.font=`400 ${said.frameSize}px ${family}`;ctx.fillStyle=labelInk;
    ctx.fillText(frame,(width-ctx.measureText(frame).width)/2,y);
    y+=said.frameH+said.gap;
  }
  if(photo){
    const band={x:inset+pad,y,w:textW,h:photoH};
    const scale=Math.max(band.w/photo.width,band.h/photo.height);
    const sw=band.w/scale,sh=band.h/scale,sx=(photo.width-sw)/2,sy=(photo.height-sh)/2;
    ctx.save();ctx.beginPath();
    const pr=kind==='inspiration'?8:20;ctx.moveTo(band.x+pr,band.y);ctx.arcTo(band.x+band.w,band.y,band.x+band.w,band.y+band.h,pr);ctx.arcTo(band.x+band.w,band.y+band.h,band.x,band.y+band.h,pr);ctx.arcTo(band.x,band.y+band.h,band.x,band.y,pr);ctx.arcTo(band.x,band.y,band.x+band.w,band.y,pr);ctx.closePath();ctx.clip();
    ctx.drawImage(photo,sx,sy,sw,sh,band.x,band.y,band.w,band.h);ctx.restore();
    y+=photoSpace;
  }
  const textTop=y;
  const lineX=(text:string)=>centred?(width-ctx.measureText(text).width)/2:x0+pad;
  for(const [index,item] of selected.items.entries()){
    if(index){ctx.strokeStyle=ruleInk;ctx.lineWidth=2;ctx.beginPath();
      if(centred){ctx.moveTo(cx-60,y-22);ctx.lineTo(cx+60,y-22);}else{ctx.moveTo(inset+pad,y-22);ctx.lineTo(inset+bubbleW-pad,y-22);}
      ctx.stroke();}
    if(item.label||item.date){
      ctx.font=`400 26px ${family}`;ctx.fillStyle=labelInk;
      const label=[item.label,item.date].filter(Boolean).join(' · ');
      if(ctx.measureText(label).width>textW)throw new ArtifactLayoutError('too_long');
      ctx.fillText(label,lineX(label),y);y+=50;
    }
    ctx.font=`${said?400:wordWeight} ${selected.size}px ${family}`;ctx.fillStyle=wordInk;
    for(const line of item.lines){ctx.fillText(line,lineX(line),y);y+=selected.size*leading;}
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

  /* THE HOME SCREEN'S GRAIN, on the top of mind: the world, the creature
     and the bubble there all carry a fine paper grain, and a clean canvas
     next to it read as a different material. Seeded, so the same words
     always make the same card. */
  if(said)laySignedGrain(ctx,width,height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new ArtifactLayoutError('unavailable')),'image/png'));
  /* The editor covers the words: under the frame line when there is one, so
     the line stays visible while you type. Each line of a field sits half its
     leading below the box's top, so the box starts that much higher. */
  const halfLead=((leading-1)*selected.size)/2;
  const radius=said?Math.round(19*said.s):kind==='principle'?0:16;
  const padX=said?said.padX:pad;
  /* …and under the photo when there is one, so the photo stays in view. */
  const editTop=(said&&frame)||photo?textTop-halfLead:y0;
  const layout:ShareCardLayout={width,height,
    bubble:{x:x0,y:y0,w:bubbleW,h:bubbleH,radius,fill:said?SAID_FILL:(dark?'#efe6d4':'#fffdf8')},
    text:{x:x0+padX,y:textTop,w:bubbleW-padX*2,size:selected.size,leading,weight:said?400:wordWeight,family,ink:wordInk,align:said?'center':'left'},
    edit:{x:x0,y:editTop,w:bubbleW,h:y1-editTop,padTop:Math.max(0,textTop-editTop-halfLead),padX,padBottom:said?said.padBottom:pad,
      radiusTop:(said&&frame)||photo?0:radius,radiusBottom:radius,
      rotation:!said&&kind!=='principle'?NOTE_TILT:0,origin:{x:cx,y:(y0+y1)/2}}};
  return {blob,width,height,fallbackFont,layout};
}
