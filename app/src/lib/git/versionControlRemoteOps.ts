/** True when fetch, pull, or push is in flight. */
export function isRemoteGitOperationBusy(state: {
  fetchBusy: boolean;
  pullBusy: boolean;
  pushBusy: boolean;
}): boolean {
  return state.fetchBusy || state.pullBusy || state.pushBusy;
}

/** True when any version-control toolbar git command is in flight. */
export function isVersionControlToolbarBusy(state: {
  fetchBusy: boolean;
  pullBusy: boolean;
  pushBusy: boolean;
  refreshBusy: boolean;
}): boolean {
  return state.refreshBusy || isRemoteGitOperationBusy(state);
}

/** Guard for starting fetch/pull/push — blocks parallel remote operations. */
export function canStartRemoteGitOperation(state: {
  fetchBusy: boolean;
  pullBusy: boolean;
  pushBusy: boolean;
  refreshBusy: boolean;
}): boolean {
  return !isVersionControlToolbarBusy(state);
}
