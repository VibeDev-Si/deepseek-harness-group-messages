import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageAssets,readAsset,type AttachmentPorts} from '../src/host/assets.ts';
import {validateDraftFiles} from '../src/client/attachments.ts';
import type {Asset} from '../src/core/model.ts';
const asset=(kind:'file'|'image'):Asset=>({id:'asset-'+kind,kind,name:kind==='image'?'image.png':'note.txt',bytes:3,mediaType:kind==='image'?'image/png':'text/plain',sourceSessionId:'source',ref:{attachmentId:'hash-'+kind,name:kind==='image'?'image.png':'note.txt',bytes:3}});
test('fan-out and retries stage independent native receipts with exact original bytes',async()=>{const calls:{sessionId:string;data:string;image:boolean}[]=[];let counter=0;const consume=async(request:Parameters<AttachmentPorts['fileUploads']['uploadStream']>[0],image:boolean)=>{const parts:Uint8Array[]=[];for await(const part of request.data)parts.push(part);calls.push({sessionId:request.sessionId,data:Buffer.concat(parts).toString(),image});return {receiptId:'receipt-'+(++counter)};};const ports:AttachmentPorts={attachments:{async *readFileStream(){yield Buffer.from('raw');}},fileUploads:{uploadStream:request=>consume(request,false),uploadImageStream:request=>consume(request,true)}};const first=await stageAssets(ports,'session-a',[asset('file'),asset('image')],new AbortController().signal);const second=await stageAssets(ports,'session-b',[asset('file'),asset('image')],new AbortController().signal);assert.deepEqual(calls.map(call=>call.data),['raw','raw','raw','raw']);assert.deepEqual(calls.map(call=>call.image),[false,true,false,true]);assert.equal(first[0].type,'file');assert.equal(second[0].type,'file');assert.notEqual(first[0].receiptId,second[0].receiptId);assert.equal(calls[2].sessionId,'session-b');});
test('legacy hosts receive images as native encoded content and files as fresh receipts',async()=>{
 let uploads=0;const ports:AttachmentPorts={attachments:{async *readFileStream(){yield Buffer.from('r');yield Buffer.from('aw');}},fileUploads:{async uploadStream(request){for await(const _part of request.data){}uploads++;return {receiptId:request.sessionId+'-'+uploads};}}};
 const parts=await stageAssets(ports,'legacy',[asset('image'),asset('file')],new AbortController().signal);
 assert.deepEqual(parts,[{type:'image',data:Buffer.from('raw').toString('base64'),mediaType:'image/png',name:'image.png'},{type:'file',receiptId:'legacy-1'}]);assert.equal(uploads,1);
});
test('legacy image preparation enforces byte limits and cancellation even after the final chunk',async()=>{
 const abort=new AbortController();let uploads=0;const ports:AttachmentPorts={attachments:{async *readFileStream(){yield Buffer.from('raw');abort.abort();}},fileUploads:{async uploadStream(){uploads++;return {receiptId:'unused'};}}};
 await assert.rejects(stageAssets(ports,'s',[asset('image')],abort.signal),{name:'AbortError'});
 ports.attachments={async *readFileStream(){yield Buffer.alloc(10*1024*1024+1);}};
 await assert.rejects(stageAssets(ports,'s',[asset('image')],new AbortController().signal),/读取上限/);assert.equal(uploads,0);
});
test('attachment reads use native bytes and expose no filesystem path',async()=>{const result=await readAsset({attachments:{async *readFileStream(){yield Buffer.from('raw');}}},asset('file'),new AbortController().signal);assert.deepEqual(result,{name:'note.txt',mediaType:'text/plain',data:Buffer.from('raw').toString('base64')});});
test('draft attachments enforce count and byte limits before uploading',()=>{assert.throws(()=>validateDraftFiles(Array.from({length:9},()=>({size:1}))));assert.throws(()=>validateDraftFiles([{size:10*1024*1024+1}]));assert.throws(()=>validateDraftFiles([{size:10*1024*1024},{size:10*1024*1024},{size:6*1024*1024}]));});
