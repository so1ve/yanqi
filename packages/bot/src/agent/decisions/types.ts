export interface MessageSelection {
  requestIds: string[];
  memoryIds: string[];
}

export interface DecisionRequest {
  input: string;
  questions: Record<
    string,
    { instructions: string; criteria: Record<string, string> }
  >;
}

export type EvaluateDecision = (
  request: DecisionRequest,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>;
