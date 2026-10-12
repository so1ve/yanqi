export interface DecisionRequest {
  input: string;
  instructions: string;
  criteria: Record<string, string>;
}

export type EvaluateDecision = (request: DecisionRequest) => Promise<unknown>;
