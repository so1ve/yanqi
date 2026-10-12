export interface DecisionRequest {
  input: string;
  questions: Record<
    string,
    { instructions: string; criteria: Record<string, string> }
  >;
}

export type EvaluateDecision = (
  request: DecisionRequest,
) => Promise<Record<string, unknown>>;
