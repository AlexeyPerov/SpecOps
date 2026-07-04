import { isMacOs, isWindows } from "../services/platform";

export interface GitInstallHint {
  title: string;
  body: string;
  installUrl: string;
  installLinkLabel: string;
}

/** Platform-aware copy for the version-control empty state when git is missing. */
export function gitInstallHint(): GitInstallHint {
  if (isMacOs()) {
    return {
      title: "Git not found",
      body:
        "Install Git to use version control in this workspace. On macOS, Xcode Command Line Tools or Homebrew are the usual options.",
      installUrl: "https://git-scm.com/download/mac",
      installLinkLabel: "Download Git for macOS",
    };
  }

  if (isWindows()) {
    return {
      title: "Git not found",
      body:
        "Install Git to use version control in this workspace. The official Windows installer includes Git Bash and credential helpers. If Git is already installed, ensure it is on PATH or in a default install location.",
      installUrl: "https://git-scm.com/download/win",
      installLinkLabel: "Download Git for Windows",
    };
  }

  return {
    title: "Git not found",
    body: "Install Git and ensure it is on your PATH to use version control in this workspace.",
    installUrl: "https://git-scm.com/downloads",
    installLinkLabel: "Download Git",
  };
}
