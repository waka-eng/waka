/** Content wins over decoration when the home scene cannot fit vertically. */
export function homeActivityLayout(height:number,contentHeight:number,bottomReserve:number,companionSize:number){
  const composerHeight=52,gap=20;
  const composerTop=Math.max(0,height-bottomReserve-composerHeight-gap);
  const contentLimit=Math.max(0,composerTop-gap);
  return {
    compact:contentHeight+companionSize+gap*2>composerTop,
    contentLimit,
    composerTop,
  };
}
