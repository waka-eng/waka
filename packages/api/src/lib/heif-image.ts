import jpeg from 'jpeg-js';

type Pixels = {width:number; height:number; data:Uint8ClampedArray};
type HeifImage = {
  is_primary(): boolean;
  get_width(): number;
  get_height(): number;
  display(pixels:Pixels, callback:(result:Pixels|null)=>void): void;
  free(): void;
};
type Decoder = {decoder:number|null; decode(bytes:Uint8Array):HeifImage[]};
type Heif = {
  HeifDecoder: new()=>Decoder;
  heif_context_free(context:number):void;
};

// Standard 12 MP mobile photos (including 4032 × 3024) fit this bound.
// Each invocation permits one decoder so the RGBA and WASM heaps cannot
// multiply with the worker's job concurrency.
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 8192;
let modulePromise:Promise<Heif>|undefined;

function heifModule() {
  // The ESM bundle embeds its WASM. There is no external file or service.
  // @ts-expect-error The pinned embedded ESM initializer has no declaration.
  return import('libheif-js/libheif-wasm/libheif-bundle.mjs').then(async ({default:load}) =>
    await load({print:()=>{},printErr:()=>{}}) as Heif);
}

export class HeifImageError extends Error {
  constructor(readonly transient:boolean) {
    super(transient?'HEIF decoder unavailable':'HEIF image could not be converted within size limits');
  }
}

let converting=false;
export async function heifInferenceJpeg(bytes:Uint8Array, byteLimit:number):Promise<Uint8Array> {
  if (!bytes.length || bytes.length>byteLimit) throw new HeifImageError(false);
  if (converting) throw new HeifImageError(true);
  converting=true;
  try {
    const heif=await (modulePromise??=heifModule().catch(()=>{
      modulePromise=undefined;
      throw new HeifImageError(true);
    }));
    const decoder=new heif.HeifDecoder();
    let images:HeifImage[]=[];
    try {
      images=decoder.decode(bytes);
      const primary=images.find(image=>image.is_primary());
      if(!primary)throw new HeifImageError(false);
      const width=primary.get_width(),height=primary.get_height();
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
         width>MAX_SIDE||height>MAX_SIDE||width*height>MAX_PIXELS)throw new HeifImageError(false);
      const pixels=await new Promise<Pixels|null>(resolve=>{
        primary.display({width,height,data:new Uint8ClampedArray(width*height*4)},resolve);
      });
      if(!pixels||pixels.width!==width||pixels.height!==height)throw new HeifImageError(false);
      const image=jpeg.encode(pixels,85).data;
      if(image.length>byteLimit)throw new HeifImageError(false);
      return image;
    } catch {
      throw new HeifImageError(false);
    } finally {
      for(const image of images)image.free();
      if(decoder.decoder!==null)heif.heif_context_free(decoder.decoder);
    }
  } finally {
    converting=false;
  }
}
