window.__baselineSamples=[];
window.__baselineCapture=async label=>{
 const sample={label,at:new Date().toISOString(),viewport:[innerWidth,innerHeight],theme:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor,uiFontSize:getComputedStyle(document.body).fontSize,...await window.__TAURI_INTERNALS__.invoke('workspace_acceptance_diagnostics')};
 window.__baselineSamples.push(sample);
 await window.__TAURI_INTERNALS__.invoke('plugin:fs|write_text_file',new TextEncoder().encode(JSON.stringify(window.__baselineSamples,null,2)),{headers:{path:encodeURIComponent((await window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory',{directory:14}))+'/spec-ops/acceptance-baseline.json'),options:'{}'}});
};
setTimeout(()=>window.__baselineCapture('baseline-thirty-cold'),2000);
