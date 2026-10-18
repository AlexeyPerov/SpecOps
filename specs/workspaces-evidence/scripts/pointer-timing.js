(() => {
  if (window.__workspacePointerTiming) throw new Error('Already installed');
  const samples=[];let previous=null;const active=()=>document.querySelector('[data-workspace-id][aria-current="true"],.rail-workspace-card-active[data-workspace-id],.rail-button-active[data-workspace-id]')?.dataset.workspaceId;const down=()=>{previous=active()};document.addEventListener("pointerdown",down,true);
  const handler=event=>{
    const row=event.target.closest('[data-workspace-id]');if(!row)return;
    const start=performance.now(), id=row.dataset.workspaceId, previousContextId=previous, viewport=[innerWidth,innerHeight];
    requestAnimationFrame(()=>requestAnimationFrame(async()=>{
      let current=document.querySelector('[data-workspace-id="'+CSS.escape(id)+'"]');
      const selected=()=>!!current&&(/(?:card-active|button-active|row-active)/.test(current.className)||current.getAttribute('aria-current')==='true'||current.getAttribute('aria-pressed')==='true');
      const firstTwoFramesMs=performance.now()-start;
      while(!selected()&&performance.now()-start<2000){await new Promise(requestAnimationFrame);current=document.querySelector('[data-workspace-id="'+CSS.escape(id)+'"]');}
      samples.push({id,previousContextId,viewport,ms:performance.now()-start,firstTwoFramesMs,selected:selected(),timeout:!selected(),at:new Date().toISOString(),className:current?.className});
    }));
  };
  document.addEventListener('pointerup',handler,true);
  window.__workspacePointerTiming={samples,json:()=>JSON.stringify({viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,samples}),stop:()=>{document.removeEventListener("pointerup",handler,true);document.removeEventListener("pointerdown",down,true)}};
  return 'Pointer release to two animation frames; samples include selected-state verification, not restore completion.';
})();
