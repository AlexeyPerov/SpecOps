import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resolveRepoRoot } from "./gitRepo";
import { queryRepositoryStatusSummary } from "./repositoryStatusSummary";
import { isBackgroundGitAllowedInApp } from "./gitIntegrationGating";
import { disposeWorkspaceGitSummaryService, getWorkspaceGitSummarySnapshot, refreshWorkspaceGitSummaries, setWorkspaceGitSummaryWindowActive, subscribeWorkspaceGitSummary } from "./workspaceGitSummary";
const runtime = vi.hoisted(() => ({ event: null as null | ((event: {payload:any})=>void), settings: null as null | (()=>void), sequence: 0 }));
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/event",()=>({listen:vi.fn(async(_name,listener)=>{runtime.event=listener;return vi.fn();})}));
vi.mock("@tauri-apps/api/webviewWindow",()=>({getCurrentWebviewWindow:()=>({label:"main"})}));
vi.mock("../state/appState",()=>({appState:{subscribe:(listener:()=>void)=>{runtime.settings=listener; return vi.fn();}}}));
vi.mock("./gitIntegrationGating",()=>({isBackgroundGitAllowedInApp:vi.fn(()=>true)}));
vi.mock("./gitRepo",()=>({resolveRepoRoot:vi.fn(),invalidateResolveRepoRootCache:vi.fn()}));
vi.mock("./repositoryStatusSummary",()=>({queryRepositoryStatusSummary:vi.fn()}));
vi.mock("./versionControlRefresh",()=>({subscribeVersionControlMutations:vi.fn(()=>vi.fn())}));
const unknown={status:"unknown",refreshing:false,summary:null,checkedAt:null,error:null};
const summary={branchName:"main",isDetached:false,aheadBehind:null,isDirty:true,isUnborn:false,hasConflicts:false};
const fresh={...unknown,status:"fresh",summary,checkedAt:Date.now()};
const flush=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
function payload(rows:any[]=[],grants:any[]=[]){return {sequence:++runtime.sequence,rows,grants};}
function send(rows:any[]=[],grants:any[]=[]){runtime.event?.({payload:payload(rows,grants)});}
beforeEach(async()=>{
  disposeWorkspaceGitSummaryService(); await flush(); vi.clearAllMocks(); runtime.sequence=0;
  vi.mocked(isBackgroundGitAllowedInApp).mockReturnValue(true);
  vi.mocked(resolveRepoRoot).mockResolvedValue({ok:true,repoRoot:"/repo"});
  vi.mocked(queryRepositoryStatusSummary).mockResolvedValue(summary);
  vi.mocked(invoke).mockImplementation(async()=>payload());
});
afterEach(async()=>{disposeWorkspaceGitSummaryService(); await flush(); vi.useRealTimers();});
describe("workspace summary consumer service",()=>{
  it("requests only enabled visible demand and raises an active alias priority",async()=>{
    setWorkspaceGitSummaryWindowActive(true);
    const hidden=subscribeWorkspaceGitSummary("/hidden",vi.fn(),{priority:"visible",enabled:false});
    const a=subscribeWorkspaceGitSummary("/repo",vi.fn(),{priority:"visible"});
    const b=subscribeWorkspaceGitSummary("/repo",vi.fn(),{priority:"active"});
    await flush();
    expect(invoke).toHaveBeenCalledWith("workspace_git_summary_sync",{demands:[{rootPath:"/repo",priority:0}],active:true});
    expect(resolveRepoRoot).not.toHaveBeenCalled();
    a.unsubscribe();b.unsubscribe();hidden.unsubscribe();await flush();
    expect(invoke).toHaveBeenLastCalledWith("workspace_git_summary_sync",{demands:[],active:true});
  });
  it("does no reading while unfocused or background Git is forbidden",async()=>{
    subscribeWorkspaceGitSummary("/repo",vi.fn());await flush();
    expect(invoke).toHaveBeenLastCalledWith("workspace_git_summary_sync",{demands:[{rootPath:"/repo",priority:1}],active:false});
    vi.mocked(isBackgroundGitAllowedInApp).mockReturnValue(false);setWorkspaceGitSummaryWindowActive(true);await flush();
    expect(invoke).toHaveBeenLastCalledWith("workspace_git_summary_sync",{demands:[],active:true});
    expect(resolveRepoRoot).not.toHaveBeenCalled();
  });
  it("retains passive metadata demand on blur and reuses it when focus returns",async()=>{
    setWorkspaceGitSummaryWindowActive(true);subscribeWorkspaceGitSummary("/repo",vi.fn());await flush();
    setWorkspaceGitSummaryWindowActive(false);await flush();
    expect(invoke).toHaveBeenLastCalledWith("workspace_git_summary_sync",{demands:[{rootPath:"/repo",priority:1}],active:false});
    expect(resolveRepoRoot).not.toHaveBeenCalled();
    setWorkspaceGitSummaryWindowActive(true);await flush();
    expect(invoke).toHaveBeenLastCalledWith("workspace_git_summary_sync",{demands:[{rootPath:"/repo",priority:1}],active:true});
  });
  it("coalesces repeated native grants and passes the same lease through resolution and status",async()=>{
    setWorkspaceGitSummaryWindowActive(true);subscribeWorkspaceGitSummary("/repo",vi.fn());await flush();
    const grant={key:"/repo",rootPath:"/repo",lease:"lease1",revision:2,window:"main"};
    send([], [grant]);send([], [grant]);await flush();send([], [grant]);await flush();
    expect(resolveRepoRoot).toHaveBeenCalledTimes(1);expect(queryRepositoryStatusSummary).toHaveBeenCalledTimes(1);
    expect(resolveRepoRoot).toHaveBeenCalledWith("/repo","background",{summaryLease:"lease1",timeoutMs:30_000});
    expect(queryRepositoryStatusSummary).toHaveBeenCalledWith("/repo","background",{summaryLease:"lease1",timeoutMs:30_000});
    expect(invoke).toHaveBeenCalledWith("workspace_git_summary_complete",{lease:"lease1",revision:2,summary,error:null,notGit:false});
  });
  it("publishes individual rows immediately and never regresses from an older IPC snapshot",async()=>{
    const a=vi.fn(),b=vi.fn();setWorkspaceGitSummaryWindowActive(true);
    subscribeWorkspaceGitSummary("/a",a);subscribeWorkspaceGitSummary("/b",b);await flush();
    const old=payload([{path:"/a",snapshot:{...fresh,summary:{...summary,branchName:"old"}}}]);
    send([{path:"/a",snapshot:fresh}]);runtime.event?.({payload:old});
    expect(getWorkspaceGitSummarySnapshot("/a").summary?.branchName).toBe("main");
    expect(getWorkspaceGitSummarySnapshot("/b").status).toBe("unknown");
    expect(a).toHaveBeenCalledTimes(2);expect(b).toHaveBeenCalledTimes(1);
  });
  it("preserves supplied previous status after timeout and completes the native lease",async()=>{
    setWorkspaceGitSummaryWindowActive(true);subscribeWorkspaceGitSummary("/repo",vi.fn());await flush();
    send([{path:"/repo",snapshot:fresh}]);vi.mocked(queryRepositoryStatusSummary).mockRejectedValueOnce(new Error("timed out"));
    send([], [{key:"/repo",rootPath:"/repo",lease:"timeout",revision:0,window:"main"}]);await flush();
    expect(invoke).toHaveBeenCalledWith("workspace_git_summary_complete",expect.objectContaining({lease:"timeout",error:expect.stringContaining("timed out")}));
    send([{path:"/repo",snapshot:{...fresh,status:"error",error:"timed out"}}]);
    expect(getWorkspaceGitSummarySnapshot("/repo").summary).toEqual(summary);
  });
  it.each(["blur","settings","dispose"])("settles explicit refresh and frees temporary demand on %s",async(mode)=>{
    setWorkspaceGitSummaryWindowActive(true);
    vi.mocked(invoke).mockImplementation(async(name)=>name==="workspace_git_summary_refresh"?payload([{path:"/repo",snapshot:{...unknown,status:"loading",refreshing:true}}]):payload());
    let done=false;const refresh=refreshWorkspaceGitSummaries(["/repo"]).then(()=>{done=true;});await flush();expect(done).toBe(false);
    if(mode==="blur")setWorkspaceGitSummaryWindowActive(false);
    if(mode==="settings"){vi.mocked(isBackgroundGitAllowedInApp).mockReturnValue(false);runtime.settings?.();}
    if(mode==="dispose")disposeWorkspaceGitSummaryService();
    await refresh;await flush();expect(done).toBe(true);
    if (mode === "dispose") expect(invoke).toHaveBeenLastCalledWith("workspace_git_summary_detach");
    else expect(invoke).toHaveBeenLastCalledWith("workspace_git_summary_sync",{demands:[],active:mode!=="blur"});
  });
  it("marks TTL expiry stale without starting another read",async()=>{
    vi.useFakeTimers();setWorkspaceGitSummaryWindowActive(true);subscribeWorkspaceGitSummary("/repo",vi.fn());await flush();
    send([{path:"/repo",snapshot:{...fresh,checkedAt:Date.now()}}]);const calls=vi.mocked(invoke).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_001);
    expect(getWorkspaceGitSummarySnapshot("/repo").status).toBe("stale");expect(invoke).toHaveBeenCalledTimes(calls);
  });
});
