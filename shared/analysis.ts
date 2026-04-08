export type AnalysisConfidence = "low" | "medium" | "high";

export interface FoodItemEstimate {
  name: string;
  estimatedCalories: number;
}

export interface CalorieAnalysis {
  totalCalories: number;
  confidence: AnalysisConfidence;
  items: FoodItemEstimate[];
  summary: string;
  disclaimer: string;
}

export interface AnalysisApiSuccess {
  data: CalorieAnalysis;
}

export interface AnalysisApiError {
  error: string;
  retryable?: boolean;
}

interface ModelAnalysisPayload {
  isFood?: boolean;
  shouldRetry?: boolean;
  retryReason?: string;
  totalCalories?: number;
  confidence?: string;
  items?: Array<{ name?: string; estimatedCalories?: number }>;
  summary?: string;
}

export const ANALYSIS_DISCLAIMER = "This is an approximate calorie estimate, not nutrition advice.";
export const DEFAULT_RETRY_REASON =
  "The photo is not clear enough for a reliable estimate. Try one bright photo of a single plate.";

export const analysisResponseSchema = {
  type: "object",
  properties: {
    isFood: { type: "boolean" },
    shouldRetry: { type: "boolean" },
    retryReason: { type: "string" },
    totalCalories: { type: "integer", minimum: 0, maximum: 5000 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string", minLength: 8, maxLength: 320 },
    items: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80 },
          estimatedCalories: { type: "integer", minimum: 0, maximum: 3000 },
        },
        required: ["name", "estimatedCalories"],
        additionalProperties: false,
      },
    },
  },
  required: ["isFood", "shouldRetry", "retryReason", "confidence", "summary", "items"],
  additionalProperties: false,
} as const;

export class RetryableAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableAnalysisError";
  }
}

export function normalizeAnalysisResponse(raw: unknown): CalorieAnalysis {
  const payload = parseModelPayload(raw);
  const items = sanitizeItems(payload.items ?? []);
  const retryReason = normalizeRetryReason(payload.retryReason);

  if (payload.isFood === false || payload.shouldRetry || items.length === 0) {
    throw new RetryableAnalysisError(retryReason);
  }

  const totalCalories = normalizeTotal(payload.totalCalories, items);
  if (totalCalories === null) {
    throw new RetryableAnalysisError(retryReason);
  }

  return {
    totalCalories,
    confidence: normalizeConfidence(payload.confidence),
    items,
    summary: normalizeSummary(payload.summary),
    disclaimer: ANALYSIS_DISCLAIMER,
  };
}

function parseModelPayload(raw: unknown): ModelAnalysisPayload {
  const extracted = extractResponsePayload(raw);

  if (!isRecord(extracted)) {
    throw new Error("Workers AI returned an unexpected response shape.");
  }

  return extracted;
}

function extractResponsePayload(raw: unknown): unknown {
  if (isRecord(raw) && "response" in raw) {
    return extractResponsePayload(raw.response);
  }

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error("Workers AI returned non-JSON output.");
    }
  }

  return raw;
}

function sanitizeItems(items: Array<{ name?: string; estimatedCalories?: number }>) {
  return items
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const estimatedCalories =
        typeof item.estimatedCalories === "number" && Number.isFinite(item.estimatedCalories)
          ? Math.max(0, Math.round(item.estimatedCalories))
          : null;

      if (!name || estimatedCalories === null) {
        return null;
      }

      return {
        name,
        estimatedCalories,
      };
    })
    .filter((item): item is FoodItemEstimate => item !== null);
}

function normalizeTotal(totalCalories: number | undefined, items: FoodItemEstimate[]) {
  const providedTotal =
    typeof totalCalories === "number" && Number.isFinite(totalCalories)
      ? Math.max(0, Math.round(totalCalories))
      : null;

  const summedTotal = items.reduce((sum, item) => sum + item.estimatedCalories, 0);

  if (providedTotal !== null && providedTotal > 0) {
    return providedTotal;
  }

  return summedTotal > 0 ? summedTotal : null;
}

function normalizeConfidence(confidence: string | undefined): AnalysisConfidence {
  if (confidence === "high" || confidence === "low") {
    return confidence;
  }

  return "medium";
}

function normalizeSummary(summary: string | undefined) {
  if (typeof summary !== "string") {
    return "Estimated from a single food photo.";
  }

  const trimmed = summary.trim();
  return trimmed || "Estimated from a single food photo.";
}

function normalizeRetryReason(retryReason: string | undefined) {
  if (typeof retryReason !== "string") {
    return DEFAULT_RETRY_REASON;
  }

  const trimmed = retryReason.trim();
  return trimmed || DEFAULT_RETRY_REASON;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
