/**
 * Stable import path for git IPC helpers and domain APIs.
 * Implementation is split across focused modules; this file re-exports the public surface.
 */

export {
  REMOTE_GIT_OPERATION_TIMEOUT_MS,
  cancelGitCommand,
  checkGitAvailable,
  resetGitAvailabilityCacheForTests,
  runGit,
} from "./gitRun";

export {
  checkoutBranch,
  createBranch,
  isNoUpstreamAheadBehindError,
  queryAheadBehind,
  queryBranches,
  queryCurrentBranch,
  queryIsBareRepository,
  resolveRepoRoot,
} from "./gitRepo";

export {
  COMMIT_FILE_DIFF_MAX_BYTES,
  DIFF_CONTEXT_LINES,
  buildQueryCommitsArgs,
  queryCommitDetail,
  queryCommitFileDiff,
  queryCommits,
} from "./gitHistory";

export {
  createCommit,
  isWorkingTreeDirty,
  queryWorkingTreeFileDiff,
  queryWorkingTreeStatus,
  stageAll,
  stagePaths,
  unstagePaths,
} from "./gitWorkingTree";

export {
  fetchRemote,
  pullRemote,
  pushRemote,
  queryRemoteTags,
  queryRemotes,
  type RemoteOperationTarget,
} from "./gitRemotes";

export {
  applyStash,
  createStash,
  createTag,
  deleteLocalTag,
  deleteRemoteTag,
  deleteTag,
  dropStash,
  pushTag,
  queryStashes,
  queryTags,
  type DeleteTagOptions,
} from "./gitTagsStash";

export {
  GitCommandCancelledError,
  GitCommandTimedOutError,
  GitCommitFileDiffNotFoundError,
  GitCommitValidationError,
  GitDiffTooLargeError,
  GitNoUpstreamError,
  GitRefValidationError,
  GitStashApplyConflictError,
  GitStashNotFoundError,
  GitStashNothingToSaveError,
  GitTagPartialDeleteError,
  isGitCommandCancelledError,
  isGitCommandTimedOutError,
} from "./gitErrors";

export type {
  AheadBehindCounts,
  BranchSummary,
  CommitDecorator,
  CommitDecoratorType,
  CommitDetail,
  CommitFileChange,
  CommitFileStatus,
  CommitSummary,
  CurrentBranchInfo,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  GitAvailableResponse,
  GitError,
  GitRemote,
  GitStashSummary,
  GitTagSummary,
  HistoryFilterMode,
  ParsedTextDiff,
  QueryCommitsOptions,
  RunGitResponse,
  WorkingTreeDiffSource,
  WorkingTreeFileEntry,
  WorkingTreeStatus,
} from "./types";
export { DEFAULT_COMMIT_LOG_LIMIT, DEFAULT_HISTORY_FILTER_MODE } from "./types";
export { GIT_LOG_FORMAT, GIT_SHOW_FORMAT } from "./gitParse";
export {
  createGitCommandError,
  createGitInvalidPathError,
  createGitNotARepositoryError,
  isGitError,
  isGitNotARepositoryError,
  mapGitInvokeError,
  normalizeGitOutputPath,
} from "./types";
