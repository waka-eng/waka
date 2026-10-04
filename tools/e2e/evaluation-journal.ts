import {mkdirSync,renameSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

/** Write before dispatch and after each response. A killed process leaves its
 * last complete snapshot, including attempts whose cost is still unknown. */
export function writeEvaluationSnapshot(path:string,snapshot:unknown){
  mkdirSync(dirname(path),{recursive:true});
  const temporary=`${path}.tmp`;
  writeFileSync(temporary,JSON.stringify(snapshot,null,2),{mode:0o600});
  renameSync(temporary,path);
}
