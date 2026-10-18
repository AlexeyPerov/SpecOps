(async () => {
  const invoke=window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
  const base=(await invoke('plugin:path|resolve_directory',{directory:14})).replace(/[\\/]$/,'')+'/spec-ops/';
  const save=(file,value)=>invoke('plugin:fs|write_text_file',new TextEncoder().encode(JSON.stringify(value,null,2)),{headers:{path:encodeURIComponent(base+file),options:'{}'}});
  const rect=selector=>document.querySelector(selector)?.getBoundingClientRect().toJSON()??null;
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const report={samples:[],search:[],errors:[],windowId:window.__TAURI_INTERNALS__.metadata.currentWindow.label};
  const resultFile=report.windowId==='main'?'acceptance-resources.json':'acceptance-resources.'+report.windowId+'.json';
  const navigation=async()=>{try{const raw=await invoke('plugin:fs|read_text_file',{path:base+'session-navigation.'+report.windowId+'.json',options:{}});return JSON.parse(new TextDecoder().decode(raw instanceof ArrayBuffer?raw:Uint8Array.from(raw)));}catch(error){return {error:String(error)}}};
  const capture=async label=>{
    const catalog=await invoke('project_catalog_transaction',{mutations:[]});
    const persisted=await navigation();
    const value={nativeFocused:await invoke('plugin:window|is_focused',{label:report.windowId}),visibility:document.visibilityState,documentFocused:document.hasFocus(),navigationError:persisted.error??null,theme:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor,uiFontSize:getComputedStyle(document.body).fontSize,openContexts:persisted.snapshot?.workspaces?.map(w=>({id:w.id,rootPath:w.rootPath}))??[],activeContextId:persisted.snapshot?.activeContextId,managerStates:[...document.querySelectorAll('.wm-row')].map(row=>({name:row.querySelector('.wm-name')?.textContent,state:row.children[3]?.textContent,git:row.querySelector('.wm-git-text')?.textContent})),label,at:new Date().toISOString(),viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,
      rail:rect('.activity-rail'),list:rect('.rail-workspaces'),manager:rect('.workspace-manager-view'),
      renderedRailRows:document.querySelectorAll('[data-workspace-id]').length,
      visibleRailRows:[...document.querySelectorAll('[data-workspace-id]')].filter(e=>{const b=e.getBoundingClientRect(),p=document.querySelector('.rail-workspaces').getBoundingClientRect();return b.bottom>p.top&&b.top<p.bottom}).length,
      folderNames:Object.values(catalog.folders).map(f=>f.name),catalogProjects:Object.keys(catalog.projects).length,savedContexts:Object.keys(catalog.savedContexts).length,
      git:await invoke('workspace_git_summary_diagnostics'),files:await invoke('get_file_watcher_diagnostics')};
    report.samples.push(value);await save(resultFile,report);return value;
  };
  const input=(element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));};
  window.__evidence={report,save,capture,paint,input,
    async search(count=40){
      const field=document.querySelector('[aria-label="Search all workspaces"]');
      if(!field)throw new Error('Open Workspace Manager first');
      const before=await invoke('workspace_git_summary_diagnostics');
      for(let i=0;i<count;i++){
        const query=i%2?'project-02':'shared-project',expected=i%2?1:5,t=performance.now();
        input(field,query);await Promise.resolve();await new Promise(requestAnimationFrame);
        const rows=document.querySelectorAll('.wm-row');
        report.search.push({query,expected,rows:rows.length,ms:performance.now()-t,correct:rows.length===expected});
      }
      report.searchGit={before,after:await invoke('workspace_git_summary_diagnostics')};input(field,'');
      await save(resultFile,report);return report.search;
    },
    async geometry(label){await paint();return capture(label)},
    click(label){const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===label||e.getAttribute('aria-label')===label);if(!e)throw new Error('Missing button '+label);e.click();return e;},
    async row(name){const e=[...document.querySelectorAll('.wm-row')].find(e=>e.querySelector('.wm-name')?.textContent.trim()===name);if(!e)throw new Error('Missing Manager row '+name);e.click();await paint();},
    later(code){setTimeout(()=>Promise.resolve(code()).catch(error=>{report.errors.push(String(error));save(resultFile,report)}),3000)}
  };
  return 'Native evidence helper ready';
})();
