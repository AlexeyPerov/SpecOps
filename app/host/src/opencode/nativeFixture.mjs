#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync,readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) { console.log('1.17.4'); process.exit(0); }
const port=Number(process.argv[process.argv.indexOf('--port')+1]);
const authPath=join(process.env.XDG_DATA_HOME,'opencode','auth.json');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync(join(process.env.HOME,'fixture-child'),String(child.pid));
const server=createServer(async(req,res)=>{
 const expected=`Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
 if(req.headers.authorization!==expected){res.statusCode=401;res.end();return;}
 res.setHeader('Content-Type','application/json');
 if(req.url==='/global/health'){res.end(JSON.stringify({healthy:true,version:'1.17.4'}));return;}
 if(req.url==='/provider'){res.end(JSON.stringify({all:[],default:{},connected:existsSync(authPath)?Object.keys(JSON.parse(readFileSync(authPath,'utf8'))):[]}));return;}
 if(req.url?.startsWith('/auth/')){const provider=decodeURIComponent(req.url.slice(6));const current=existsSync(authPath)?JSON.parse(readFileSync(authPath,'utf8')):{};if(req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;current[provider]=JSON.parse(body);}else delete current[provider];writeFileSync(authPath,JSON.stringify(current));res.end('true');return;}
 if(req.url==='/config/providers'){res.end(JSON.stringify({providers:[],default:{}}));return;}
 if(req.url==='/agent'){res.end('[]');return;}
 res.statusCode=404;res.end('{}');
});
server.listen(port,'127.0.0.1');
