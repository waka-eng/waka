import {Buffer} from 'node:buffer';

/** bcrypt's limit is UTF-8 bytes, not JavaScript characters. */
export const PASSWORD_MAX_BYTES=72;
export function passwordFitsByteLimit(password:string):boolean {
  return Buffer.byteLength(password,'utf8')<=PASSWORD_MAX_BYTES;
}
