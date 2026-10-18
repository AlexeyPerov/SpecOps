export interface GitRefNameValidation {
  ok: true;
}

export interface GitRefNameValidationError {
  ok: false;
  message: string;
}

export type GitRefNameValidationResult = GitRefNameValidation | GitRefNameValidationError;

const INVALID_BRANCH_CHARS = /[\x00-\x1f\x7f ~^:?*[\\]/;
const INVALID_BRANCH_SEQUENCE = /\.\.|@{/;

/**
 * Validate a local branch name using basic git ref rules (refs/heads/*).
 * Rejects invalid names before invoking git.
 */
export function validateGitRefName(name: string): GitRefNameValidationResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, message: "Branch name cannot be empty." };
  }

  if (trimmed === "@") {
    return { ok: false, message: "Branch name cannot be '@'." };
  }

  if (trimmed.startsWith(".") || trimmed.endsWith(".") || trimmed.endsWith("/")) {
    return { ok: false, message: "Branch name cannot start with '.' or end with '.' or '/'." };
  }

  if (trimmed.startsWith("/")) {
    return { ok: false, message: "Branch name cannot start with '/'." };
  }

  // Reject a leading dash so the name cannot be misparsed as an option when it is
  // later placed bare on the argv (e.g. `["tag", name]`, `["checkout", "-b", name]`).
  if (trimmed.startsWith("-")) {
    return { ok: false, message: "Branch name cannot start with '-'." };
  }

  if (trimmed.endsWith(".lock")) {
    return { ok: false, message: "Branch name cannot end with '.lock'." };
  }

  if (INVALID_BRANCH_SEQUENCE.test(trimmed)) {
    return { ok: false, message: "Branch name cannot contain '..' or '@{'." };
  }

  if (INVALID_BRANCH_CHARS.test(trimmed)) {
    return {
      ok: false,
      message: "Branch name contains invalid characters (spaces, ~, ^, :, ?, *, [, \\).",
    };
  }

  // Per-component rules (each `/`-separated part): no empty part (`a//b`), no
  // part starting with `.` (`a/.b`, `a/./b`), no part ending with `.lock`
  // (`a.lock/b`).
  for (const component of trimmed.split("/")) {
    if (!component) {
      return { ok: false, message: "Branch name cannot contain empty path components ('//')." };
    }
    if (component.startsWith(".")) {
      return { ok: false, message: "Branch name components cannot start with '.'." };
    }
    if (component.endsWith(".lock")) {
      return { ok: false, message: "Branch name components cannot end with '.lock'." };
    }
  }

  if (trimmed.length > 255) {
    return { ok: false, message: "Branch name is too long (max 255 characters)." };
  }

  return { ok: true };
}
