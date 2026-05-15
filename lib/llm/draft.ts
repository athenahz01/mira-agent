import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { draftJsonSchema, type DraftJson } from "../db/draft.ts";
import type { MediaKitJson } from "../db/media-kit.ts";
import type { ResearchBriefJson } from "../db/research-brief.ts";
import type { VoiceStyleGuideJson } from "../db/style-guide";
import type { Json, Tables } from "../db/types";
import type { DealType, ScoringBrand } from "../scoring/rules.ts";
import type { CreatorProfileSummary } from "./voice-guide";
import { createAnthropicClient } from "./anthropic.ts";

const defaultSonnetModel = "claude-sonnet-4-5";
const fallbackSonnetModel = "claude-sonnet-4-20250514";
const publicFooterLocation = "NYC, NY";

export type DraftInput = {
  creatorProfile: CreatorProfileSummary;
  voiceStyleGuide: VoiceStyleGuideJson;
  mediaKit: MediaKitJson;
  brand: ScoringBrand;
  researchBrief: ResearchBriefJson;
  dealType: DealType;
  senderDisplayName: string;
  senderEmail: string;
  physicalAddress: string;
  targetContact: Tables<"brand_contacts"> | null;
  angleHint?: string;
};

export class DraftGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftGenerationError";
  }
}

export async function generateDraft(input: DraftInput): Promise<DraftJson> {
  const { prompt, promptHash } = await buildDraftPrompt(input);
  const preferredModel = process.env.ANTHROPIC_SONNET_MODEL ?? defaultSonnetModel;

  try {
    return await generateWithModel(prompt, promptHash, preferredModel);
  } catch (error) {
    if (
      process.env.ANTHROPIC_SONNET_MODEL ||
      preferredModel === fallbackSonnetModel ||
      !isModelNameError(error)
    ) {
      throw error;
    }
  }

  return generateWithModel(prompt, promptHash, fallbackSonnetModel);
}

async function generateWithModel(
  prompt: string,
  promptHash: string,
  model: string,
): Promise<DraftJson> {
  const firstResponse = await requestJson(prompt, model);
  const firstParsed = parseDraftJson(firstResponse.text, {
    modelUsed: firstResponse.model,
    promptHash,
  });

  if (firstParsed.success) {
    return firstParsed.data;
  }

  const retryPrompt = `${prompt}

Your previous response did not match the schema. Return corrected JSON only.

Schema validation error:
${firstParsed.error.message}`;

  const secondResponse = await requestJson(retryPrompt, model);
  const secondParsed = parseDraftJson(secondResponse.text, {
    modelUsed: secondResponse.model,
    promptHash,
  });

  if (!secondParsed.success) {
    throw new DraftGenerationError(secondParsed.error.message);
  }

  return secondParsed.data;
}

async function requestJson(prompt: string, model: string) {
  const anthropic = createAnthropicClient();
  const message = await anthropic.messages.create({
    model,
    max_tokens: 2600,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return {
    model: message.model,
    text: message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim(),
  };
}

export async function buildDraftPrompt(input: DraftInput) {
  const promptPath = path.join(process.cwd(), "prompts", "draft-v1.md");
  const template = await readFile(promptPath, "utf8");
  const footerText = buildFooterText(input);
  const sender = {
    display_name: input.senderDisplayName,
    email: input.senderEmail,
    instagram: normalizeInstagramHandle(input.creatorProfile.handle),
    website: input.mediaKit.contact.website ?? null,
    footer_location: publicFooterLocation,
    has_configured_physical_address: input.physicalAddress.trim().length > 0,
  };
  const prompt = template
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
    .replace(
      "{{RESEARCH_BRIEF_JSON}}",
      JSON.stringify(input.researchBrief, null, 2),
    )
    .replace("{{DEAL_TYPE}}", input.dealType)
    .replace("{{SENDER_JSON}}", JSON.stringify(sender, null, 2))
    .replace(
      "{{TARGET_CONTACT_JSON}}",
      JSON.stringify(input.targetContact, null, 2),
    )
    .replace("{{ANGLE_HINT}}", input.angleHint?.trim() || "None")
    .replace("{{FOOTER_TEXT}}", footerText);

  return {
    prompt,
    promptHash: createHash("sha256").update(prompt).digest("hex"),
  };
}

function parseDraftJson(
  rawText: string,
  trace: { modelUsed: string; promptHash: string },
) {
  const parsedJson = extractJson(rawText);

  if (!parsedJson.success) {
    return parsedJson;
  }

  const withTrace = {
    ...parsedJson.data,
    body_html: null,
    model_used: trace.modelUsed,
    prompt_hash: trace.promptHash,
  };
  const parsedDraft = draftJsonSchema.safeParse(withTrace);

  if (!parsedDraft.success) {
    return {
      success: false as const,
      error: parsedDraft.error,
    };
  }

  return {
    success: true as const,
    data: parsedDraft.data,
  };
}

function extractJson(rawText: string) {
  try {
    return {
      success: true as const,
      data: JSON.parse(rawText) as Record<string, Json>,
    };
  } catch {
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return {
        success: false as const,
        error: new DraftGenerationError("Anthropic returned no JSON."),
      };
    }

    try {
      return {
        success: true as const,
        data: JSON.parse(rawText.slice(firstBrace, lastBrace + 1)) as Record<
          string,
          Json
        >,
      };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error
            ? error
            : new DraftGenerationError("Could not parse draft JSON."),
      };
    }
  }
}

function buildFooterText(input: DraftInput) {
  const handle = normalizeInstagramHandle(input.creatorProfile.handle);
  const parts = [input.senderDisplayName, handle];

  if (input.mediaKit.contact.website) {
    parts.push(input.mediaKit.contact.website);
  }

  parts.push(publicFooterLocation);
  return parts.join(" | ");
}

function normalizeInstagramHandle(handle: string) {
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function isModelNameError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("model") && message.includes("not");
}
