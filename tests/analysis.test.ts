import { describe, expect, it } from "vitest";
import {
  ANALYSIS_DISCLAIMER,
  RetryableAnalysisError,
  normalizeAnalysisResponse,
} from "../shared/analysis";

describe("normalizeAnalysisResponse", () => {
  it("normalizes a structured Workers AI payload", () => {
    const result = normalizeAnalysisResponse({
      response: {
        isFood: true,
        shouldRetry: false,
        retryReason: "",
        totalCalories: 540,
        confidence: "medium",
        summary: "Estimated from one plate photo.",
        items: [
          { name: "Grilled chicken", estimatedCalories: 260 },
          { name: "Rice", estimatedCalories: 180 },
          { name: "Vegetables", estimatedCalories: 100 },
        ],
      },
    });

    expect(result.totalCalories).toBe(540);
    expect(result.items).toHaveLength(3);
    expect(result.disclaimer).toBe(ANALYSIS_DISCLAIMER);
  });

  it("parses a stringified JSON payload and derives totals when needed", () => {
    const result = normalizeAnalysisResponse({
      response: JSON.stringify({
        isFood: true,
        shouldRetry: false,
        retryReason: "",
        confidence: "high",
        summary: "A compact meal with rice and eggs.",
        items: [
          { name: "Rice", estimatedCalories: 220 },
          { name: "Eggs", estimatedCalories: 180 },
        ],
      }),
    });

    expect(result.totalCalories).toBe(400);
    expect(result.confidence).toBe("high");
  });

  it("throws a retryable error when the model flags the image as unclear", () => {
    expect(() =>
      normalizeAnalysisResponse({
        response: {
          isFood: true,
          shouldRetry: true,
          retryReason: "Image is too blurry to identify the food.",
          confidence: "low",
          summary: "Too blurry.",
          items: [],
        },
      }),
    ).toThrowError(RetryableAnalysisError);
  });

  it("throws for malformed non-JSON model output", () => {
    expect(() =>
      normalizeAnalysisResponse({
        response: "not json",
      }),
    ).toThrowError("Workers AI returned non-JSON output.");
  });
});
