import { redactForSerialization } from "../redact";
import { adapterErrors } from "../../../src/lib/session/adapter/errors";
export const CURSOR_TOOLSETS = { none: [], "files-read": ["read", "grep", "glob", "ls", "readLints"], "files-write": ["read", "grep", "glob", "ls", "readLints", "edit", "delete"] } as const;
export interface CursorParameter { id: string; values: string[] }
export const PARAM_PREFIX = "modelParameter:";
const safe = (value: string, key: string) => (!key || !value.includes(key)) && redactForSerialization(value) === value;
const identifier = /^[A-Za-z0-9._:-]{1,100}$/;
export function cursorParameters(rows: unknown, key: string): CursorParameter[] {
  if (!Array.isArray(rows) || rows.length > 16) return [];
  const found = new Set<string>();
  return rows.flatMap(p => {
    if (!p || typeof p.id !== "string" || !identifier.test(p.id) || !safe(p.id,key) || found.has(p.id) || !Array.isArray(p.values) || !p.values.length || p.values.length > 32) return [];
    const values = p.values.map((v: any) => v?.value);
    if (values.some((v: any) => typeof v !== "string" || !identifier.test(v) || !safe(v,key)) || new Set(values).size !== values.length) return [];
    found.add(p.id); return [{id:p.id, values}];
  });
}
export function cursorPolicy(values: Readonly<Record<string, unknown>> | undefined = undefined, parameters: readonly CursorParameter[] = []) {
  const input = values ?? {};
  if (typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["toolset", "sandbox", ...parameters.map(p => PARAM_PREFIX+p.id)].includes(k))) throw adapterErrors.capabilityNotSupported("native-session-settings");
  const toolset = input.toolset ?? "none", sandbox = input.sandbox ?? "enabled";
  if (typeof toolset !== "string" || !Object.hasOwn(CURSOR_TOOLSETS, toolset) || typeof sandbox !== "string" || !["enabled", "disabled"].includes(sandbox)) throw adapterErrors.capabilityNotSupported("native-session-settings");
  const modelParams = parameters.flatMap(p => {
    const value = input[PARAM_PREFIX+p.id];
    if (value === undefined || value === "") return [];
    if (typeof value !== "string" || !p.values.includes(value)) throw adapterErrors.capabilityNotSupported("native-model-parameter");
    return [{id:p.id,value}];
  }).sort((a,b)=>a.id.localeCompare(b.id));
  return {toolset,sandbox,tools:[...CURSOR_TOOLSETS[toolset as keyof typeof CURSOR_TOOLSETS]],settingSources:[],modelParams,writeCapability:toolset === "files-write" ? "possible" : "unknown"};
}
export function validCursorMetadata(meta: Readonly<Record<string,unknown>>): boolean {
  try {
    if (Object.keys(meta).length !== 7 || typeof meta.workspaceRootPath !== "string" || !meta.workspaceRootPath.startsWith("/") || meta.workspaceRootPath.length > 4096 || !Array.isArray(meta.modelParams) || meta.modelParams.length > 16) return false;
    const params = meta.modelParams as {id:string;value:string}[];
    if (params.some(p => !p || Object.keys(p).length !== 2 || typeof p.id !== "string" || typeof p.value !== "string" || !identifier.test(p.id) || !identifier.test(p.value) || !safe(p.id, "") || !safe(p.value, "")) || new Set(params.map(p=>p.id)).size !== params.length) return false;
    const policy = cursorPolicy({toolset:meta.toolset,sandbox:meta.sandbox,...Object.fromEntries(params.map(p=>[PARAM_PREFIX+p.id,p.value]))},params.map(p=>({id:p.id,values:[p.value]})));
    return Object.keys(policy).every(k => JSON.stringify(policy[k as keyof typeof policy]) === JSON.stringify(meta[k]));
  } catch { return false; }
}
