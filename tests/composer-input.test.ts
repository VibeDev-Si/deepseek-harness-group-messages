import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldSubmitMessage} from '../src/client/composer-input.ts';
test('Enter sends while Shift+Enter inserts a newline',()=>{assert.equal(shouldSubmitMessage({key:'Enter',shiftKey:false,isComposing:false}),true);assert.equal(shouldSubmitMessage({key:'Enter',shiftKey:true,isComposing:false}),false);});
test('Chinese/Japanese IME confirmation never submits the draft',()=>{assert.equal(shouldSubmitMessage({key:'Enter',shiftKey:false,isComposing:true}),false);assert.equal(shouldSubmitMessage({key:'Enter',shiftKey:false,isComposing:false,keyCode:229}),false);});
import {submissionKind} from '../src/client/composer-input.ts';
test('quoted slash text cannot silently become a native permission command',()=>{assert.equal(submissionKind('/permission danger-full-access','',true,['permission']),'prompt');assert.equal(submissionKind('/permission read-only','',false,['permission']),'command');assert.equal(submissionKind('/new-command args','new-command',false,[]),'command');assert.equal(submissionKind('/unknown text','',false,['permission']),'prompt');});
