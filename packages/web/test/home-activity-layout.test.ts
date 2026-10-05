/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. These tests exercise the pure
 * space budget; actual DOM measurements and scrolling require browser checks. */
import {describe,expect,it} from 'vitest';
import {homeActivityLayout} from '../src/lib/home-activity-layout';

describe('home activity space budget',()=>{
  it('keeps decoration when the content and full-size companion fit',()=>{
    expect(homeActivityLayout(844,453,48,120).compact).toBe(false);
  });
  it('prioritizes activities and capture on a short phone without shrinking the character',()=>{
    const layout=homeActivityLayout(568,444,48,120);
    expect(layout.compact).toBe(true);
    expect(layout.contentLimit+20).toBe(layout.composerTop);
    expect(layout.composerTop+52+20+48).toBe(568);
  });
  it('handles long readings on desktop too, and does not depend on scroll position',()=>{
    const layout=homeActivityLayout(800,1100,48,120);
    expect(layout.compact).toBe(true);
    expect(layout.contentLimit).toBe(660);
    expect(homeActivityLayout(800,1100,48,120)).toEqual(layout);
  });
});
