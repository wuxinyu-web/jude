const test=require('node:test');
const assert=require('node:assert/strict');
const sync=require('../lib/sync-core.js');

test('independent collection additions merge without overwriting',()=>{
  const a=sync.reconcile({ytd_vocabulary:[{id:'a',term:'alpha',createdAt:1}]},{},'desktop',100);
  const b=sync.reconcile({ytd_vocabulary:[{id:'b',term:'beta',createdAt:2}]},{},'mobile',200);
  const values=sync.materialize(sync.merge(a,b)).ytd_vocabulary;
  assert.deepEqual(values.map(item=>item.id),['b','a']);
});

test('a newer deletion tombstone prevents resurrection',()=>{
  const first=sync.reconcile({ytd_notes:[{id:'n1',text:'note'}]},{},'desktop',100);
  const deleted=sync.reconcile({ytd_notes:[]},first,'desktop',300);
  const stale=sync.reconcile({ytd_notes:[{id:'n1',text:'old'}]},{},'mobile',200);
  assert.deepEqual(sync.materialize(sync.merge(deleted,stale)).ytd_notes,[]);
});

test('secrets caches and parent password are never exported',()=>{
  const records=sync.currentRecords({
    ytd_settings:{aiApiKey:'secret'},digest_video:{transcript:[]},ytd_parent_mode:{hash:'secret'},
    ytd_sentences:[{id:'s1',term:'hello'}],
  });
  assert.equal(Object.keys(records).length,1);
  assert.ok(Object.keys(records)[0].startsWith('ytd_sentences/'));
  assert.equal(JSON.stringify(records).includes('secret'),false);
});

test('study sessions remain separate records',()=>{
  const records=sync.currentRecords({ytd_study:{schemaVersion:2,currentId:'one',sessions:[{id:'one',createdAt:1},{id:'two',createdAt:2}]}});
  assert.equal(Object.keys(records).length,3);
  assert.equal(sync.materialize(sync.reconcile({ytd_study:{schemaVersion:2,currentId:'one',sessions:[{id:'one',createdAt:1},{id:'two',createdAt:2}]}},{},'d',1)).ytd_study.currentId,null);
});

test('deleting every study session materializes an empty container',()=>{
  const first=sync.reconcile({ytd_study:{schemaVersion:2,currentId:'one',sessions:[{id:'one',createdAt:1}]}},{},'desktop',100);
  const deleted=sync.reconcile({ytd_study:{schemaVersion:2,currentId:null,sessions:[]}},first,'desktop',200);
  assert.deepEqual(sync.materialize(deleted).ytd_study,{schemaVersion:2,currentId:null,sessions:[]});
});
