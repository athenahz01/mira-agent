import { readFile } from "node:fs/promises";
import path from "node:path";

import { mediaKitJsonSchema, type MediaKitJson } from "../db/media-kit.ts";
import type { VoiceStyleGuideJson } from "../db/style-guide";
import type { CreatorProfileSummary } from "./voice-guide";
import { createAnthropicClient } from "./anthropic.ts";
import { rateBenchmarks, type RateBenchmarks } from "./rate-benchmarks.ts";

const defaultSonnetModel = "claude-sonnet-4-5";
const fallbackSonnetModel = "claude-sonnet-4-20250514";

export type PastBrandWorkInput = MediaKitJson["past_brand_work"][number];
export type MediaKitAudienceSnapshot = {
  follower_count: number;
  engagement_rate: number;
  tier: string;
};

export class MediaKitGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaKitGenerationError";
  }
}

export async function generateMediaKitData(input: {
  creatorProfile: CreatorProfileSummary;
  voiceStyleGuide: VoiceStyleGuideJson;
  audienceSnapshot: MediaKitAudienceSnapshot;
  pastBrandWork: PastBrandWorkInput[];
  industryBenchmarks: RateBenchmarks;
  userEmail: string;
  userWebsite: string | null;
}): Promise<MediaKitJson> {
  const prompt = await buildMediaKitPrompt(input);
  const preferredModel = process.env.ANTHROPIC_SONNET_MODEL ?? defaultSonnetModel;

  try {
    return await generateWithModel(prompt, preferredModel);
  } catch (error) {
    if (
      process.env.ANTHROPIC_SONNET_MODEL ||
      preferredModel === fallbackSonnetModel ||
      !isModelNameError(error)
    ) {
      throw error;
    }
  }

  return generateWithModel(prompt, fallbackSonnetModel);
}

export { rateBenchmarks };

async function generateWithModel(
  prompt: string,
  model: string,
): Promise<MediaKitJson> {
  const firstResponse = await requestJson(prompt, model);
  const firstParsed = parseMediaKitJson(firstResponse);

  if (firstParsed.success) {
    return firstParsed.data;
  }

  const retryPrompt = `${prompt}

Your previous response did not match the schema. Return corrected JSON only.

Schema validation error:
${firstParsed.error.message}`;

  const secondResponse = await requestJson(retryPrompt, model);
  const secondParsed = parseMediaKitJson(secondResponse);

  if (!secondParsed.success) {
    throw new MediaKitGenerationError(secondParsed.error.message);
  }

  return secondParsed.data;
}

async function requestJson(prompt: string, model: string) {
  const anthropic = createAnthropicClient();
  const message = await anthropic.messages.create({
    model,
    max_tokens: 3500,
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

async function buildMediaKitPrompt(input: {
  creatorProfile: CreatorProfileSummary;
  voiceStyleGuide: VoiceStyleGuideJson;
  audienceSnapshot: MediaKitAudienceSnapshot;
  pastBrandWork: PastBrandWorkInput[];
  industryBenchmarks: RateBenchmarks;
  userEmail: string;
  userWebsite: string | null;
}) {
  const promptPath = path.join(process.cwd(), "prompts", "media-kit-v1.md");
  const template = await readFile(promptPath, "utf8");
  const contact = {
    email: input.userEmail,
    website: input.userWebsite,
    instagram: `https://instagram.com/${input.creatorProfile.handle.replace(/^@/, "")}`,
  };

  return template
    .replace(
      "{{CREATOR_PROFILE_JSON}}",
      JSON.stringify(input.creatorProfile, null, 2),
    )
    .replace(
      "{{VOICE_GUIDE_JSON}}",
      JSON.stringify(input.voiceStyleGuide, null, 2),
    )
    .replace(
      "{{AUDIENCE_SNAPSHOT_JSON}}",
      JSON.stringify(input.audienceSnapshot, null, 2),
    )
    .replace(
      "{{PAST_BRAND_WORK_JSON}}",
      JSON.stringify(input.pastBrandWork, null, 2),
    )
    .replace(
      "{{RATE_BENCHMARKS_JSON}}",
      JSON.stringify(input.industryBenchmarks, null, 2),
    )
    .replace("{{CONTACT_JSON}}", JSON.stringify(contact, null, 2));
}

function parseMediaKitJson(rawText: string) {
  const parsedJson = extractJson(rawText);

  if (!parsedJson.success) {
    return parsedJson;
  }

  const parsedKit = mediaKitJsonSchema.safeParse(parsedJson.data);

  if (!parsedKit.success) {
    return {
      success: false as const,
      error: parsedKit.error,
    };
  }

  return {
    success: true as const,
    data: parsedKit.data,
  };
}

function extractJson(rawText: string) {
  try {
    return {
      success: true as const,
      data: JSON.parse(rawText) as unknown,
    };
  } catch {
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return {
        success: false as const,
        error: new MediaKitGenerationError("Anthropic returned no JSON."),
      };
    }

    try {
      return {
        success: true as const,
        data: JSON.parse(rawText.slice(firstBrace, lastBrace + 1)) as unknown,
      };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error
            ? error
            : new MediaKitGenerationError("Could not parse media kit JSON."),
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
