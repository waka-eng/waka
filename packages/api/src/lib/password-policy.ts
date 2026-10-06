import {Buffer} from 'node:buffer';

/** bcrypt's limit is UTF-8 bytes, not JavaScript characters. */
export const PASSWORD_MAX_BYTES=72;
/** Reject lone UTF-16 surrogates before bcrypt's legacy UTF-8 encoder. */
export function passwordIsWellFormed(password:string):boolean {
  for(let index=0;index<password.length;index+=1){
    const code=password.charCodeAt(index);
    if(code>=0xD800&&code<=0xDBFF){
      const next=password.charCodeAt(index+1);
      if(!(next>=0xDC00&&next<=0xDFFF))return false;
      index+=1;
    }else if(code>=0xDC00&&code<=0xDFFF)return false;
  }
  return true;
}
export function passwordFitsByteLimit(password:string):boolean {
  return Buffer.byteLength(password,'utf8')<=PASSWORD_MAX_BYTES;
}
