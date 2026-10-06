/** WHAT THIS MOCKS, AND WHY: nothing. Actual bcrypt hashing/verifying tests
 * new-password boundaries and compatibility with historical hashes. All
 * passwords are synthetic; no account, database or provider is contacted. */
import bcrypt from 'bcryptjs';
import {describe,expect,it} from 'vitest';
import {hashPassword,verifyPassword} from './auth.js';

describe('new password byte boundaries',()=>{
  it.each(['a'.repeat(72),'가'.repeat(24),'😀'.repeat(18),'a'.repeat(68)+'😀'])('keeps a complete 72-byte password',async password=>{
    const hash=await hashPassword(password);
    expect(await verifyPassword(password,hash)).toBe(true);
    expect(await verifyPassword(password.slice(0,-1),hash)).toBe(false);
  });
  it.each(['a'.repeat(73),'가'.repeat(25),'😀'.repeat(19),'a'.repeat(69)+'😀'])('refuses a new hash that would discard bytes',async password=>{
    await expect(hashPassword(password)).rejects.toThrow(/72.*bytes|bytes.*72/);
  });
  it('preserves exact spaces without normalization',async()=>{
    const password='  a synthetic password  ',hash=await hashPassword(password);
    expect(await verifyPassword(password,hash)).toBe(true);
    expect(await verifyPassword(password.trim(),hash)).toBe(false);
  });
  it('retains legacy long-password verification instead of blocking existing accounts',async()=>{
    const password='a'.repeat(72)+'legacy suffix',hash=await bcrypt.hash(password,4);
    expect(await verifyPassword(password,hash)).toBe(true);
    expect(await verifyPassword('b'+password.slice(1),hash)).toBe(false);
  });
});
