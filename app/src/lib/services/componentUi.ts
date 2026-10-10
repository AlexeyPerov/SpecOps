import type { ComponentId, InstallError } from './componentManager';
export const componentLabel: Record<ComponentId, string> = { node: 'Shared Node runtime', codex: 'Codex', opencode: 'OpenCode', claude: 'Claude', cursor: 'Cursor' };
export function componentBytes(value: number): string { return `${(value / 1048576).toFixed(1)} MiB (${value.toLocaleString()} bytes)`; }
const failures: Partial<Record<InstallError, string>> = {
 unavailable: 'Distribution is unavailable. No approved download is offered.', unsupported: 'This platform is unsupported.',
 network: 'Offline or network unavailable. Restore connectivity, then review and retry.', timeout: 'Download timed out. Check connectivity and retry.',
 'low-disk': 'Insufficient disk space. Free space, then review and retry.', storage: 'Software storage is unavailable. Check disk permissions and space.',
 integrity: 'The downloaded file is damaged or its identity changed. Retry requires a verified download.', 'unsafe-archive': 'The archive failed safety verification. Installation is blocked.',
 target: 'The component is incompatible with this platform.', probe: 'The installed version failed its account-free compatibility probe.',
 'in-use': 'This version or a shared dependency is in use. Stop its sessions explicitly before changing it.', busy: 'Another window owns a software operation. Wait and refresh.',
 foreign: 'This operation belongs to another window. Manage it in the original window.', stale: 'This review or operation expired. Refresh and review a new plan.',
 catalog: 'Trusted catalog information is unavailable. Installed software and the editor remain independent of a catalog refresh.',
 cancelled: 'Installation cancelled. Session and account bindings are preserved.', shutdown: 'Installation was interrupted. Review a new plan before retrying.',
 confirmation: 'The reviewed plan changed. Refresh and review a new plan.', limit: 'The retry or plan limit was reached. Refresh before reviewing a new installation.',
 http: 'The distribution server refused the download. Retry after service recovery.', redirect: 'The distribution redirected the download. Installation is blocked.',
};
export function componentFailure(failure: unknown): string {
 const code = typeof failure === 'string' ? failure : failure instanceof Error ? failure.message : '';
 return failures[code as InstallError] ?? 'Software management is unavailable. Refresh to retry; your editor, account and session history are preserved.';
}
