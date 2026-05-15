import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  researchBriefJsonSchema,
  type ResearchBriefJson,
} from "../db/research-brief.ts";
import type { MediaKitJson, PastBrandWorkInput } from "../db/media-kit.ts";
import type { VoiceStyleGuideJson } from "../db/style-guide";
import type { Json } from "../db/types";
import type { ScoreRationaleJson } from "../scoring/service.ts";
import type { DealType, ScoringBrand } from "../scoring/rules.ts";
import type { CreatorProfileSummary } from "./voice-guide";
import { createAnthropicClient } from "./anthropic.ts";

const defaultOpusModel = "claude-opus-4-7";
const fallbackOpusModel = "claude-opus-4-1-20250805";

export type BrandFitScoreSummary = ScoreRationaleJson;

export type ResearchBriefInput = {
  creatorProfile: CreatorProfileSummary;
  voiceStyleGuide: VoiceStyleGuideJson;
  mediaKit: MediaKitJson;
  brand: ScoringBrand;
  fitScore: BrandFitScoreSummary;
  dealType: DealType;
  pastBrandWork: PastBrandWorkInput[];
};

export class ResearchBriefGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchBriefGenerationError";
  }
}

export async function generateResearchBrief(
  input: ResearchBriefInput,
): Promise<ResearchBriefJson> {
  const prompt = await buildResearchBriefPrompt(input);
  const preferredModel = process.env.ANTHROPIC_OPUS_MODEL ?? defaultOpusModel;

  try {
    return await generateWithModel(prompt, preferredModel);
  } catch (error) {
    if (
      process.env.ANTHROPIC_OPUS_MODEL ||
      preferredModel === fallbackOpusModel ||
      !isModelNameError(error)
    ) {
      throw error;
    }
  }

  return generateWithModel(prompt, fallbackOpusModel);
}

async function generateWithModel(
  prompt: string,
  model: string,
): Promise<ResearchBriefJson> {
  const firstResponse = await requestJson(prompt, model);
  const firstParsed = parseResearchBriefJson(firstResponse);

  if (firstParsed.success) {
    return firstParsed.data;
  }

  const retryPrompt = `${prompt}

Your previous response did not match the schema. Return corrected JSON only.

Schema validation error:
${firstParsed.error.message}`;

  const secondResponse = await requestJson(retryPrompt, model);
  const secondParsed = parseResearchBriefJson(secondResponse);

  if (!secondParsed.success) {
    throw new ResearchBriefGenerationError(secondParsed.error.message);
  }

  return secondParsed.data;
}

async function requestJson(prompt: string, model: string) {
  const anthropic = createAnthropicClient();
  const message = await anthropic.messages.create({
    model,
    max_tokens: 2200,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function buildResearchBriefPrompt(input: ResearchBriefInput) {
  const promptPath = path.join(process.cwd(), "prompts", "research-brief-v1.md");
  const template = await readFile(promptPath, "utf8");

  return template
    .replace(
      "{{CREATOR_PROFILE_JSON}}",
      JSON.stringify(input.creatorProfile, null, 2),
    )
    .replace(
      "{{VOICE_GUIDE_JSON}}",
      JSON.stringify(input.voiceStyleGuide, null, 2),
    )
    .replace("{{MEDIA_KIT_JSON}}", JSON.stringify(input.mediaKit, null, 2))
    .replace("{{BRAND_CONTEXT_JSON}}", JSON.stringify(input.brand, null, 2))
    .replace("{{FIT_SCORE_JSON}}", JSON.stringify(input.fitScore, null, 2))
    .replace("{{DEAL_TYPE}}", input.dealType)
    .replace(
      "{{PAST_BRAND_WORK_JSON}}",
      JSON.stringify(input.pastBrandWork, null, 2),
    );
}

function parseResearchBriefJson(rawText: string) {
  const parsedJson = extractJson(rawText);

  if (!parsedJson.success) {
    return parsedJson;
  }

  const parsedBrief = researchBriefJsonSchema.safeParse(parsedJson.data);

  if (!parsedBrief.success) {
    return {
      success: false as const,
      error: parsedBrief.error,
    };
  }

  return {
    success: true as const,
    data: parsedBrief.data,
  };
}

function extractJson(rawText: string) {
  try {
    return {
      success: true as const,
      data: JSON.parse(rawText) as Json,
    };
  } catch {
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return {
        success: false as const,
        error: new ResearchBriefGenerationError("Anthropic returned no JSON."),
      };
    }

    try {
      return {
        success: true as const,
        data: JSON.parse(rawText.slice(firstBrace, lastBrace + 1)) as Json,
      };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error
            ? error
            : new ResearchBriefGenerationError(
                "Could not parse research brief JSON.",
              ),
      };
    }
  }
}

function isModelNameError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("model") && message.includes("not");
}
