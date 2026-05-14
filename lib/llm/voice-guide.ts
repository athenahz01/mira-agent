import { readFile } from "node:fs/promises";
import path from "node:path";

import type { VoiceStyleGuideJson } from "../db/style-guide";
import { voiceStyleGuideJsonSchema } from "../db/style-guide.ts";
import { createAnthropicClient } from "./anthropic.ts";

const defaultWritingModel = "claude-opus-4-7";
const fallbackWritingModel = "claude-opus-4-1-20250805";

export type CreatorProfileSummary = {
  handle: string;
  display_name: string;
  niche_tags: string[];
  aesthetic_keywords: string[];
  bio_extract: string | null;
  recent_post_themes: string[];
  tier: string | null;
};

export type VoiceSampleForGuide = {
  source: string;
  text: string;
  tag: string | null;
};

export class VoiceGuideGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceGuideGenerationError";
  }
}

export async function generateVoiceGuide(input: {
  creatorProfile: CreatorProfileSummary;
  voiceSamples: VoiceSampleForGuide[];
}): Promise<VoiceStyleGuideJson> {
  const prompt = await buildVoiceGuidePrompt(input);
  const preferredModel = process.env.ANTHROPIC_MODEL ?? defaultWritingModel;
  const triedModels = new Set<string>();

  try {
    return await generateWithModel(prompt, preferredModel);
  } catch (error) {
    triedModels.add(preferredModel);

    if (
      process.env.ANTHROPIC_MODEL ||
      preferredModel === fallbackWritingModel ||
      !isModelNameError(error)
    ) {
      throw error;
    }
  }

  if (!triedModels.has(fallbackWritingModel)) {
    return generateWithModel(prompt, fallbackWritingModel);
  }

  throw new VoiceGuideGenerationError("Could not generate voice guide.");
}

async function generateWithModel(
  prompt: string,
  model: string,
): Promise<VoiceStyleGuideJson> {
  const firstResponse = await requestJson(prompt, model);
  const firstParsed = parseVoiceGuideJson(firstResponse);

  if (firstParsed.success) {
    return firstParsed.data;
  }

  const retryPrompt = `${prompt}

Your previous response did not match the schema. Return corrected JSON only.

Schema validation error:
${firstParsed.error.message}`;

  const secondResponse = await requestJson(retryPrompt, model);
  const secondParsed = parseVoiceGuideJson(secondResponse);

  if (!secondParsed.success) {
    throw new VoiceGuideGenerationError(secondParsed.error.message);
  }

  return secondParsed.data;
}

async function requestJson(prompt: string, model: string) {
  const anthropic = createAnthropicClient();
  const message = await anthropic.messages.create({
    model,
    max_tokens: 2400,
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

async function buildVoiceGuidePrompt(input: {
  creatorProfile: CreatorProfileSummary;
  voiceSamples: VoiceSampleForGuide[];
}) {
  const promptPath = path.join(process.cwd(), "prompts", "voice-guide-v1.md");
  const template = await readFile(promptPath, "utf8");
  const groupedSamples = input.voiceSamples.reduce<
    Record<string, { tag: string | null; text: string }[]>
  >((groups, sample) => {
    const existing = groups[sample.source] ?? [];
    return {
      ...groups,
      [sample.source]: [
        ...existing,
        {
          tag: sample.tag,
          text: sample.text,
        },
      ],
    };
  }, {});

  return template
    .replace(
      "{{CREATOR_PROFILE_JSON}}",
      JSON.stringify(input.creatorProfile, null, 2),
    )
    .replace("{{VOICE_SAMPLES_JSON}}", JSON.stringify(groupedSamples, null, 2));
}

function parseVoiceGuideJson(rawText: string) {
  const parsedJson = extractJson(rawText);

  if (!parsedJson.success) {
    return parsedJson;
  }

  const parsedGuide = voiceStyleGuideJsonSchema.safeParse(parsedJson.data);

  if (!parsedGuide.success) {
    return {
      success: false as const,
      error: parsedGuide.error,
    };
  }

  return {
    success: true as const,
    data: parsedGuide.data,
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
        error: new VoiceGuideGenerationError("Anthropic returned no JSON."),
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
            : new VoiceGuideGenerationError("Could not parse voice guide JSON."),
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

export function validateVoiceGuideJson(input: unknown) {
  return voiceStyleGuideJsonSchema.parse(input);
}

export function parseVoiceGuideJsonForTest(input: unknown) {
  return voiceStyleGuideJsonSchema.parse(input);
}
