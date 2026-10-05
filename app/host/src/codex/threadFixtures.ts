/** Synthetic pinned native frames with profile-local persisted history, no account/network. */
export const threadFixture = String.raw`#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('codex-cli 0.160.0'); process.exit(0); }
const fs = require('node:fs'); const path = require('node:path'); const readline = require('node:readline');
const home = process.env.CODEX_HOME; const dbPath = path.join(home, 'fixture-history.json');
const authPath=path.join(home,'auth.json'); if(!fs.existsSync(authPath))fs.writeFileSync(authPath,JSON.stringify({OPENAI_API_KEY:'fixture-key-'+home}),{mode:0o600});
let db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath,'utf8')) : {}; let active = new Map(); let replies = new Map(); let counter = 0; let experimental = false;
const save = () => fs.writeFileSync(dbPath, JSON.stringify(db));
const frame = value => process.stdout.write(JSON.stringify(value)+'\n');
const notify = (method,params) => frame({method,params});
const item = (threadId,turnId,value,done) => notify(done?'item/completed':'item/started',{threadId,turnId,item:value});
function end(threadId,turn,status='completed') { if (!active.has(threadId)) return; active.delete(threadId); turn.status=status; turn.completedAt=100; save(); notify('turn/completed',{threadId,turn}); }
function finishText(threadId,turn,text) { if(!active.has(threadId)) return; const value={type:'agentMessage',id:turn.id+'-text',text,phase:null,memoryCitation:null,delivery:null,questions:null}; item(threadId,turn.id,value,false); notify('item/agentMessage/delta',{threadId,turnId:turn.id,itemId:value.id,delta:text.slice(0,3)}); notify('item/agentMessage/delta',{threadId,turnId:turn.id,itemId:value.id,delta:text.slice(3)}); item(threadId,turn.id,value,true); turn.items.push(value); end(threadId,turn); }
function approval(threadId,turn,method,params,next) { const id='server-'+(++counter); replies.set(id,next); frame({id,method,params:{threadId,turnId:turn.id,itemId:turn.id+'-tool',...params}}); }
readline.createInterface({input:process.stdin}).on('line',line=>{
 const req=JSON.parse(line); if(req.id===undefined)return;
 if(!req.method) { const next=replies.get(req.id); if(next){replies.delete(req.id);next(req.result??{decision:'decline'});}return; }
 const p=req.params??{}; let result={};
 if(req.method==='initialize'){experimental=p.capabilities?.experimentalApi===true;result={userAgent:'fixture'};}
 else if(req.method==='account/read')result={account:fs.existsSync(authPath)?{type:'apiKey'}:null,requiresOpenaiAuth:true};
 else if(req.method==='account/rateLimits/read')result={ordinaryUsageAllowed:true,rateLimits:{limitId:'coding',primary:{usedPercent:0}}};
 else if(req.method==='account/login/start'){fs.writeFileSync(authPath,JSON.stringify({OPENAI_API_KEY:p.apiKey}),{mode:0o600});result={type:'apiKey'};}
 else if(req.method==='account/logout'){if(fs.existsSync(authPath))fs.unlinkSync(authPath);}
 else if(req.method==='fixture/env')result={pid:process.pid,env:process.env};
 else if(req.method==='fixture/crash'){process.exit(23);}
 else if(req.method==='model/list')result={data:[{id:'fixture-model',model:'fixture-model',displayName:'Fixture model',hidden:false,isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}],defaultReasoningEffort:'medium'}],nextCursor:null};
 else if(req.method==='collaborationMode/list')result={data:[{name:'Default',mode:'default'},{name:'Plan',mode:'plan'}]};
 else if(req.method==='thread/start') { const id='thread-'+Object.keys(db).length; const thread={id,cwd:p.cwd,turns:[],historyMode:p.historyMode??'paginated'}; db[id]=thread;save();result={thread,model:p.model}; }
 else if(req.method==='thread/read'||req.method==='thread/resume') { const thread=db[p.threadId];if(!thread){frame({id:req.id,error:{code:-32000,message:'missing native history'}});return;} result={thread,model:'fixture-model'}; }
 else if(req.method==='thread/fork') { const source=db[p.threadId]; const id='thread-'+Object.keys(db).length; const turns=JSON.parse(JSON.stringify(source.turns));const n=p.lastTurnId?turns.findIndex(t=>t.id===p.lastTurnId)+1:turns.length;const thread={...source,id,turns:turns.slice(0,n)};db[id]=thread;save();result={thread,model:p.model,cwd:p.cwd,approvalPolicy:p.approvalPolicy,approvalsReviewer:p.approvalsReviewer,reasoningEffort:p.config.model_reasoning_effort,sandbox:{type:{"read-only":"readOnly","workspace-write":"workspaceWrite","danger-full-access":"dangerFullAccess"}[p.sandbox]}}; }
 else if(req.method==='turn/steer') { const turn=active.get(p.threadId);if(!turn||turn.id!==p.expectedTurnId){frame({id:req.id,error:{code:-32000,message:'active turn changed'}});return;}turn.items.push({type:'userMessage',id:'steered-'+p.clientUserMessageId,clientId:p.clientUserMessageId,content:p.input});save();result={turnId:turn.id}; }
 else if(req.method==='thread/compact/start') { const thread=db[p.threadId];const turn={id:'native-compact-'+thread.turns.length,itemsView:'full',items:[],status:'inProgress',startedAt:101};thread.turns.push(turn);active.set(thread.id,turn);save();frame({id:req.id,result:{}});notify('turn/started',{threadId:thread.id,turn});const compact={type:'contextCompaction',id:turn.id+'-context'};item(thread.id,turn.id,compact,false);setTimeout(()=>{if(!active.has(thread.id))return;item(thread.id,turn.id,compact,true);turn.items.push(compact);end(thread.id,turn);},40);return; }
 else if(req.method==='turn/start') {
   const thread=db[p.threadId]; const turn={id:'native-turn-'+thread.turns.length,itemsView:'full',items:[{type:'userMessage',id:'native-user-'+thread.turns.length,clientId:p.clientUserMessageId??null,content:p.input}],status:'inProgress',startedAt:100,completedAt:null,error:null};thread.turns.push(turn);active.set(thread.id,turn);save();result={turn};
   frame({id:req.id,result});notify('turn/started',{threadId:thread.id,turn});
   const prompt=p.input[0].text;
   if(prompt.startsWith('malformed-')) { const kind=prompt.slice(10);item(thread.id,turn.id,{type:kind,id:'malformed-item',status:'completed',changes:[{path:42,diff:'bad'}]},true);return;}
   if(prompt==='child-failure'){setTimeout(()=>process.exit(9),20);return;}
   if(prompt==='cancel'||prompt==='ignored-cancel')return;
   if(prompt==='failure'){setTimeout(()=>end(thread.id,turn,'failed'),5);return;}
   if(prompt==='unknown'){notify('fixture/unknown',{threadId:thread.id,turnId:turn.id,secret:'discard'});notify('item/agentMessage/delta',{threadId:thread.id,turnId:turn.id,itemId:'malformed',delta:42,secret:'contract-token-canary'});}
   if(prompt==='question'){approval(thread.id,turn,'item/tool/requestUserInput',{questions:[{id:'q',header:'Pick',question:'Which?',isSecret:false,isOther:false,options:[{label:'One',description:'First'}]}],isBlocking:true},reply=>finishText(thread.id,turn,reply.answers?.q?.answers?.join(',')??'rejected'));return;}
   if(prompt==='approval'||prompt==='approval-child-failure'||prompt==='deny'||prompt==='edit') {
     const tool={type:prompt==='edit'?'fileChange':'commandExecution',id:turn.id+'-tool',command:'fixture command',cwd:thread.cwd,status:'inProgress',changes:[{path:path.join(thread.cwd,'fixture.txt'),diff:'fixture edit'}],aggregatedOutput:null,exitCode:null};item(thread.id,turn.id,tool,false);
     approval(thread.id,turn,prompt==='edit'?'item/fileChange/requestApproval':'item/commandExecution/requestApproval',{command:'fixture command',cwd:thread.cwd},reply=>{
       const allow=reply.decision==='accept'||reply.decision==='acceptForSession';tool.status=allow?'completed':'declined';tool.aggregatedOutput=allow?'tool output':'denied';tool.exitCode=allow?0:1;
       if(allow&&prompt==='edit')fs.writeFileSync(path.join(thread.cwd,'fixture.txt'),'fixture edit');
       notify('item/commandExecution/outputDelta',{threadId:thread.id,turnId:turn.id,itemId:tool.id,delta:tool.aggregatedOutput});item(thread.id,turn.id,tool,true);turn.items.push(tool);finishText(thread.id,turn,allow?'Allowed':'Denied');});if(prompt==='approval-child-failure')setTimeout(()=>process.exit(9),30);return;
   }
   const reasoning={type:'reasoning',id:turn.id+'-reasoning',summary:['Thinking'],content:[]};item(thread.id,turn.id,reasoning,false);notify('item/reasoning/summaryTextDelta',{threadId:thread.id,turnId:turn.id,itemId:reasoning.id,summaryIndex:0,delta:'Thinking'});item(thread.id,turn.id,reasoning,true);turn.items.push(reasoning);
   const n=thread.turns.length;notify('thread/tokenUsage/updated',{threadId:thread.id,turnId:turn.id,tokenUsage:{total:{inputTokens:n*10,outputTokens:n*3,reasoningOutputTokens:n,cachedInputTokens:0,cacheWriteInputTokens:0},last:{inputTokens:10,outputTokens:3,reasoningOutputTokens:1,cachedInputTokens:0,cacheWriteInputTokens:0}}});
   setTimeout(()=>finishText(thread.id,turn,'Hello native'),5);return;
 }
 else if(req.method==='turn/interrupt') { const turn=active.get(p.threadId);if(turn?.items[0]?.content[0]?.text==='ignored-cancel')return;result={};frame({id:req.id,result});if(turn)end(p.threadId,turn,'interrupted');return; }
 else if(req.method==='fixture/frames')result={experimental};
 fs.appendFileSync(path.join(home,'fixture-requests.jsonl'),JSON.stringify({method:req.method,params:p})+'\n');
 frame({id:req.id,result});
});
`;
