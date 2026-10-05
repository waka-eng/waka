import {Fragment,type ReactNode} from 'react';

/** Small safe formatting surface: prose, lists, bold and inline code. All
 * source remains React text; model HTML, URLs and scripts are never executed. */
function inline(text:string):ReactNode[]{
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part,index)=>part.startsWith('**')&&part.endsWith('**')?<strong key={index}>{part.slice(2,-2)}</strong>:part.startsWith('`')&&part.endsWith('`')?<code key={index}>{part.slice(1,-1)}</code>:<Fragment key={index}>{part}</Fragment>);
}
export function ConversationText({text}:{text:string}){
  const blocks:ReactNode[]=[];let list:string[]=[];let ordered=false;let lines:string[]=[];
  const flushText=()=>{if(lines.length){blocks.push(<p key={`p${blocks.length}`}>{inline(lines.join('\n'))}</p>);lines=[];}};
  const flushList=()=>{if(list.length){const items=list.map((row,index)=><li key={index}>{inline(row)}</li>);blocks.push(ordered?<ol key={`l${blocks.length}`}>{items}</ol>:<ul key={`l${blocks.length}`}>{items}</ul>);list=[];}};
  for(const line of text.split('\n')){
    const match=line.match(/^\s*(?:([-*])|\d+\.)\s+(.+)$/);
    if(match){flushText();const next=!match[1];if(list.length&&next!==ordered)flushList();ordered=next;list.push(match[2]);}
    else{flushList();if(!line.trim())flushText();else lines.push(line);}
  }
  flushText();flushList();return <div className="chat-message-text">{blocks}</div>;
}
