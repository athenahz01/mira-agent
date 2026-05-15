import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { MediaKitJson } from "../db/media-kit";
import {
  replyDraftJsonSchema,
  type ReplyDraftJson,
} from "../db/reply-draft.ts";
import type { ReplyClassificationJson } from "../db/reply-classification.ts";
import type { VoiceStyleGuideJson } from "../db/style-guide";
import type { Json, Tables } from "../db/types";
import type { NewReply } from "../gmail/inbox.ts";
import type { ScoringBrand } from "../scoring/rules.ts";
import { createAnthropicClient } from "./anthropic.ts";
import { buildOutreachFooterText } from "./footer.ts";
import type { ThreadMessage } from "./reply-classify.ts";
import type { CreatorProfileSummary } from "./voice-guide";

const defaultSonnetModel = "claude-sonnet-4-5";
const fallbackSonnetModel = "claude-sonnet-4-20250514";

export type ReplyDraftInput = {
  creatorProfile: CreatorProfileSummary;
  voiceStyleGuide: VoiceStyleGuideJson;
  mediaKit: MediaKitJson;
  campaign: Tables<"campaigns">;
  brand: ScoringBrand;
  threadHistory: ThreadMessage[];
  inboundReply: NewReply;
  classification: ReplyClassificationJson;
  senderDisplayName: string;
  senderEmail: string;
  physicalAddress: string;
};

export class ReplyDraftGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplyDraftGenerationError";
  }
}

export async function generateReplyDraft(
  input: ReplyDraftInput,
): Promise<ReplyDraftJson> {
  const { prompt, promptHash } = await buildReplyDraftPrompt(input);
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
): Promise<ReplyDraftJson> {
  const firstResponse = await requestJson(prompt, model);
  const firstParsed = parseReplyDraftJson(firstResponse.text, {
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
  const secondParsed = parseReplyDraftJson(secondResponse.text, {
    modelUsed: secondResponse.model,
    promptHash,
  });

  if (!secondParsed.success) {
    throw new ReplyDraftGenerationError(secondParsed.error.message);
  }

  return secondParsed.data;
}

async function requestJson(prompt: string, model: string) {
  const anthropic = createAnthropicClient();
  const message = await anthropic.messages.create({
    model,
    max_tokens: 1800,
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

async function buildReplyDraftPrompt(input: ReplyDraftInput) {
  const promptPath = path.join(process.cwd(), "prompts", "reply-draft-v1.md");
  const template = await readFile(promptPath, "utf8");
  const footerText = buildOutreachFooterText({
    senderDisplayName: input.senderDisplayName,
    creatorHandle: input.creatorProfile.handle,
    mediaKit: input.mediaKit,
    physicalAddress: input.physicalAddress,
  });
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
    .replace("{{CAMPAIGN_JSON}}", JSON.stringify(input.campaign, null, 2))
    .replace("{{BRAND_JSON}}", JSON.stringify(input.brand, null, 2))
    .replace(
      "{{THREAD_HISTORY_JSON}}",
      JSON.stringify(input.threadHistory, null, 2),
    )
    .replace(
      "{{INBOUND_REPLY_JSON}}",
      JSON.stringify(
        {
          ...input.inboundReply,
          received_at: input.inboundReply.received_at.toISOString(),
        },
        null,
        2,
      ),
    )
    .replace(
      "{{CLASSIFICATION_JSON}}",
      JSON.stringify(input.classification, null, 2),
    )
    .replace("{{FOOTER_TEXT}}", footerText);

  return {
    prompt,
    promptHash: createHash("sha256").update(prompt).digest("hex"),
  };
}

function parseReplyDraftJson(
  rawText: string,
  trace: { modelUsed: string; promptHash: string },
) {
  const parsedJson = extractJson(rawText);

  if (!parsedJson.success) {
    return parsedJson;
  }

  const parsed = replyDraftJsonSchema.safeParse({
    ...parsedJson.data,
    model_used: trace.modelUsed,
    prompt_hash: trace.promptHash,
  });

  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error,
    };
  }

  return {
    success: true as const,
    data: parsed.data,
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
        error: new ReplyDraftGenerationError("Anthropic returned no JSON."),
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
            : new ReplyDraftGenerationError("Could not parse reply draft JSON."),
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
