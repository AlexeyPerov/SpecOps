import { threadFixture } from './threadFixtures';
/** Synthetic control plane; fixture-only inventory never contacts a tool service. */
export const ecosystemFixture = threadFixture.replace("let db =", String.raw`
const settingsPath = path.join(home, 'fixture-config.json');
let prefs = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath,'utf8')) : {version:'v1', skill:true, web_search:'cached', model_verbosity:'medium', model_reasoning_summary:'auto', mcp_servers:{local:{enabled:true,env:{CUSTOM:'OPAQUE-ENV-CANARY'},http_headers:{CUSTOM:'OPAQUE-HEADER-CANARY'}}}};
const skillPath = path.join(home,'skills','local','SKILL.md'); fs.mkdirSync(path.dirname(skillPath),{recursive:true}); fs.writeFileSync(skillPath,'fixture only');
const persistPrefs = () => fs.writeFileSync(settingsPath,JSON.stringify(prefs)); persistPrefs();
let db =`).replace("else if(req.method==='fixture/env')", String.raw`
else if(req.method==='skills/list') result={data:[{cwd:p.cwds[0],skills:[{name:'Local fixture skill',description:'token=SECRET-DESCRIPTION-CANARY',path:skillPath,scope:'user',enabled:prefs.skill,pluginId:null}],errors:[]}]};
else if(req.method==='skills/config/write'){if(p.path!==skillPath)throw new Error('unexpected skill');prefs.skill=p.enabled;persistPrefs();result={effectiveEnabled:prefs.skill};}
else if(req.method==='config/read') result={config:{...prefs,instructions:'SECRET-INSTRUCTIONS-CANARY',env:{KEY:'SECRET-ENV-CANARY'}},origins:{},layers:[{name:{type:'user',file:fs.realpathSync(path.join(home,'config.toml')),profile:null},version:prefs.version,config:prefs,disabledReason:null}]};
else if(req.method==='config/value/write') {if(p.filePath!==fs.realpathSync(path.join(home,'config.toml'))||p.expectedVersion!==prefs.version){frame({id:req.id,error:{code:-32000,message:'CAS rejected token=SECRET-ERROR-CANARY'}});return;} if(p.keyPath==='mcp_servers.local.enabled')prefs.mcp_servers.local.enabled=p.value;else prefs[p.keyPath]=p.value;prefs.version='v'+(Number(prefs.version.slice(1))+1);persistPrefs();result={status:'ok',version:prefs.version,filePath:p.filePath,overriddenMetadata:null};}
else if(req.method==='mcpServerStatus/list') result={data:prefs.mcp_servers.local.enabled?[{name:'local',pluginId:null,runtimeStatus:prefs.mcp_servers.local.enabled?'connected':'disabled',authStatus:'notLoggedIn',tools:{'fixture-tool':{description:'token=SECRET-TOOL-CANARY OPAQUE-ENV-CANARY OPAQUE-HEADER-CANARY '+(fs.existsSync(path.join(home,'.credentials.json'))?'OPAQUE-NATIVE-OAUTH-CANARY':''),inputSchema:{properties:{SECRET_SCHEMA_CANARY:{}}}}},resources:[{name:'fixture resource',uri:'https://private.test?token=SECRET-URI-CANARY'}],resourceTemplates:[],httpOrigin:'https://private.test'}]:[],nextCursor:null};
else if(req.method==='config/mcpServer/reload')result={};
else if(req.method==='fixture/env')`);
