import { recordOperationalFault } from './lib/operational-fault.js';
import { getDb } from './lib/db.js';
import { getAttachmentsBucket } from './lib/attachment-storage.js';
import { attachmentsRegion, attachmentsEndpoint } from './lib/s3-client.js';
import { attachmentStorageScope, drainAttachmentObjects } from './lib/attachment-sweep.js';
import { recordAttachmentObjectCreated } from './lib/attachment-uploads.js';

interface QueueEvent { Records: Array<{messageId:string;body:string}> }
/** S3 ObjectCreated -> SQS. Partial failure redelivery is native queue work,
 * not a timer polling an idle database. Daily reconciliation retains SQL work
 * even after dead-lettering; actual delivery/monitoring must be exercised. */
export async function handler(event: QueueEvent) {
  const batchItemFailures: Array<{itemIdentifier:string}> = [];
  for (const message of event.Records) {
    try {
      const body=JSON.parse(message.body);
      if(body.Event==='s3:TestEvent') continue;
      if(!Array.isArray(body.Records)) throw Error('Invalid object event');
      for(const record of body.Records) {
        if(record.eventSource!=='aws:s3'||!String(record.eventName).startsWith('ObjectCreated:')) continue;
        // An AWS event is never authority over a configured local endpoint.
        if(attachmentsEndpoint()||record.s3?.bucket?.name!==getAttachmentsBucket()||record.awsRegion!==attachmentsRegion()) throw Error('Object event storage mismatch');
        if(typeof record.s3?.object?.key!=='string') throw Error('Missing object key');
        const key=decodeURIComponent(record.s3.object.key.replace(/\+/g,' '));
        if(!await recordAttachmentObjectCreated(getDb(),key,attachmentStorageScope())) continue;
        const result=await drainAttachmentObjects(getDb(),{keys:[key]});
        if(result.failed) throw Error('Object cleanup pending');
      }
    } catch {
      // Do not emit object keys, event bodies, credentials or owner metadata.
      recordOperationalFault('attachment_cleanup');
      console.warn('[attachment-object-event] retry');
      batchItemFailures.push({itemIdentifier:message.messageId});
    }
  }
  return {batchItemFailures};
}
