export interface ChoiceRequest {
  title: string;
  message: string;
  options: { value: string; label: string; disabled?: boolean }[];
  allowApplyToAll?: boolean;
}
export interface ChoiceResult { value: string; applyToAll: boolean }
type Runner = (request: ChoiceRequest) => Promise<ChoiceResult | null>;
let runner: Runner | null = null;
export function registerChoiceRunner(next: Runner | null): void { runner = next; }
export function requestChoice(request: ChoiceRequest): Promise<ChoiceResult | null> {
  return runner ? runner(request) : Promise.resolve(null);
}
