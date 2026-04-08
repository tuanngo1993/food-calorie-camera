import type { AnalysisApiError, AnalysisApiSuccess } from "../../shared/analysis";
import {
  DEFAULT_RETRY_REASON,
  RetryableAnalysisError,
  analysisResponseSchema,
  normalizeAnalysisResponse,
} from "../../shared/analysis";

const PRIMARY_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const FALLBACK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

interface Env {
  AI: {
    run: (model: string, input: unknown) => Promise<unknown>;
  };
}

interface PagesContext {
  request: Request;
  env: Env;
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function onRequestPost(context: PagesContext) {
  try {
    if (!context.env.AI || typeof context.env.AI.run !== "function") {
      return json<AnalysisApiError>(
        {
          error:
            "Workers AI is not configured for this Pages project yet. Add an AI binding named 'AI' and redeploy.",
        },
        503,
      );
    }

    const formData = await context.request.formData();
    const image = formData.get("image");

    if (!(image instanceof File)) {
      return json<AnalysisApiError>(
        { error: "Upload one image file using the field name 'image'." },
        400,
      );
    }

    if (!image.type.startsWith("image/")) {
      return json<AnalysisApiError>({ error: "Only image uploads are supported." }, 400);
    }

    if (image.size > MAX_IMAGE_BYTES) {
      return json<AnalysisApiError>(
        {
          error: "This image is too large for the MVP. Try a smaller or more compressed photo.",
        },
        413,
      );
    }

    const buffer = await image.arrayBuffer();
    const imageDataUrl = `data:${image.type};base64,${arrayBufferToBase64(buffer)}`;
    const aiResponse = await runAnalysis(context.env.AI, imageDataUrl);

    const normalized = normalizeAnalysisResponse(aiResponse);

    return json<AnalysisApiSuccess>(
      {
        data: normalized,
      },
      200,
    );
  } catch (error) {
    console.error("Workers AI analyze failed", error);

    if (error instanceof RetryableAnalysisError) {
      return json<AnalysisApiError>({ error: error.message, retryable: true }, 422);
    }

    if (error instanceof SyntaxError) {
      return json<AnalysisApiError>({ error: DEFAULT_RETRY_REASON, retryable: true }, 422);
    }

    return json<AnalysisApiError>(
      {
        error:
          error instanceof Error
            ? normalizeServerError(error.message)
            : "The Cloudflare function could not analyze this image.",
        retryable: true,
      },
      500,
    );
  }
}

function json<T>(payload: T, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "Content-Type",
  };
}

function normalizeServerError(message: string) {
  if (message.includes("must submit the prompt 'agree'")) {
    return "This Cloudflare account must accept the Meta license for the cheaper vision model before it can be used directly.";
  }

  if (
    message.toLowerCase().includes("reading 'run'") ||
    message.toLowerCase().includes("reading \"run\"") ||
    message.toLowerCase().includes("undefined")
  ) {
    return "Workers AI is not configured yet. Add an AI binding named 'AI' in Cloudflare Pages and redeploy.";
  }

  if (message.toLowerCase().includes("binding")) {
    return "Workers AI is not configured yet. Add an AI binding named 'AI' in Cloudflare Pages.";
  }

  if (message.toLowerCase().includes("json")) {
    return DEFAULT_RETRY_REASON;
  }

  return "The Cloudflare function could not analyze this image.";
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function runAnalysis(ai: Env["AI"], imageDataUrl: string) {
  try {
    return await ai.run(PRIMARY_MODEL, buildModelInput(imageDataUrl));
  } catch (error) {
    if (shouldFallbackToScout(error)) {
      console.warn(
        "Primary Workers AI model requires one-time license acceptance; falling back to Scout.",
      );
      return ai.run(FALLBACK_MODEL, buildModelInput(imageDataUrl));
    }

    throw error;
  }
}

function buildModelInput(imageDataUrl: string) {
  return {
    messages: [
      {
        role: "system",
        content:
          "You estimate calories from a single plate or bowl of food. Be conservative, use only visible evidence, and never claim precision. If the image is blurry, dark, not food, or too ambiguous, set shouldRetry to true with a helpful retryReason. Return only JSON that matches the supplied schema.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Estimate the visible food items and total calories in this image. Focus on one meal only. Use a short summary.",
          },
          {
            type: "image_url",
            image_url: {
              url: imageDataUrl,
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: analysisResponseSchema,
    },
    max_tokens: 420,
    temperature: 0.2,
  };
}

function shouldFallbackToScout(error: unknown) {
  return error instanceof Error && error.message.includes("must submit the prompt 'agree'");
}
