window.__evidence.later(async()=>{
  const e=window.__evidence, invoke=window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async predicate=>{for(let n=0;n<80;n++){if(await predicate())return;await delay(100);}throw new Error('Exact root membership transition timed out')};
  const catalog=await invoke('project_catalog_transaction',{mutations:[]});
  const target=Object.values(catalog.projects).find(project=>project.name==='project-02')?.rootPath;
  if(!target)throw new Error('Fixture project-02 is missing');
  e.click('Workspace Manager');await e.paint();
  for(const button of [...document.querySelectorAll('.wm-row button')].filter(b=>b.textContent.trim()==='Close workspace')){button.click();await delay(400);}
  await until(async()=>(await invoke('get_file_watcher_diagnostics')).projectRootCount===0);
  await e.capture('exact-cycles-baseline-zero');
  for(let n=0;n<10;n++){
    e.click('Workspace Manager');await e.paint();await e.row('project-02');
    await until(async()=>(await invoke('get_file_watcher_diagnostics')).projectRoots.includes(target));
    await e.capture('exact-cycle-'+n+'-open');
    e.click('Workspace Manager');await e.paint();
    const row=[...document.querySelectorAll('.wm-row')].find(row=>row.querySelector('.wm-name')?.textContent.trim()==='project-02');
    const close=[...row.querySelectorAll('button')].find(b=>b.textContent.trim()==='Close workspace');if(!close)throw new Error('Close action missing');close.click();
    await until(async()=>{const current=[...document.querySelectorAll('.wm-row')].find(row=>row.querySelector('.wm-name')?.textContent.trim()==='project-02');return !!current&&[...current.querySelectorAll('button')].some(b=>b.textContent.trim()==='Remove from catalog')&&(await invoke('project_catalog_transaction',{mutations:[]})).savedContexts[target]&&(await invoke('get_file_watcher_diagnostics')).projectRootCount===0});
    await e.capture('exact-cycle-'+n+'-closed');
  }
  await e.capture('exact-cycles-complete');
});
