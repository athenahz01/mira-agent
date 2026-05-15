import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  replyClassificationJsonSchema,
  type ReplyClassificationJson,
} from "../db/reply-classification.ts";
import type { VoiceStyleGuideJson } from "../db/style-guide";
import type { Json, Tables } from "../db/types";
import type { NewReply } from "../gmail/inbox.ts";
import type { ScoringBrand } from "../scoring/rules.ts";
import { createAnthropicClient } from "./anthropic.ts";
import type { CreatorProfileSummary } from "./voice-guide";

const defaultSonnetModel = "claude-sonnet-4-5";
const fallbackSonnetModel = "claude-sonnet-4-20250514";

export type ThreadMessage = {
  direction: "outbound" | "inbound";
  subject: string;
  body_text: string;
  sent_at: string | null;
};

export type ReplyClassificationInput = {
  creatorProfile: CreatorProfileSummary;
  voiceStyleGuide: VoiceStyleGuideJson;
  campaign: Tables<"campaigns">;
  brand: ScoringBrand;
  miraOriginalMessage: { subject: string; body_text: string };
  reply: NewReply;
  threadHistory: ThreadMessage[];
};

export class ReplyClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplyClassificationError";
  }
}

export async function classifyReply(
  input: ReplyClassificationInput,
): Promise<ReplyClassificationJson> {
  const prompt = await buildReplyClassificationPrompt(input);
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

async function generateWithModel(
  prompt: string,
  model: string,
): Promise<ReplyClassificationJson> {
  const firstResponse = await requestJson(prompt, model);
  const firstParsed = parseReplyClassificationJson(firstResponse);

  if (firstParsed.success) {
    return firstParsed.data;
  }

  const retryPrompt = `${prompt}

Your previous response did not match the schema. Return corrected JSON only.

Schema validation error:
${firstParsed.error.message}`;
  const secondResponse = await requestJson(retryPrompt, model);
  const secondParsed = parseReplyClassificationJson(secondResponse);

  if (!secondParsed.success) {
    throw new ReplyClassificationError(secondParsed.error.message);
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

  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function buildReplyClassificationPrompt(input: ReplyClassificationInput) {
  const promptPath = path.join(process.cwd(), "prompts", "reply-classify-v1.md");
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
    .replace("{{CAMPAIGN_JSON}}", JSON.stringify(input.campaign, null, 2))
    .replace("{{BRAND_JSON}}", JSON.stringify(input.brand, null, 2))
    .replace(
      "{{ORIGINAL_MESSAGE_JSON}}",
      JSON.stringify(input.miraOriginalMessage, null, 2),
    )
    .replace(
      "{{THREAD_HISTORY_JSON}}",
      JSON.stringify(input.threadHistory, null, 2),
    )
    .replace(
      "{{REPLY_JSON}}",
      JSON.stringify(
        {
          ...input.reply,
          received_at: input.reply.received_at.toISOString(),
        },
        null,
        2,
      ),
    );
}

function parseReplyClassificationJson(rawText: string) {
  const parsedJson = extractJson(rawText);

  if (!parsedJson.success) {
    return parsedJson;
  }

  const parsed = replyClassificationJsonSchema.safeParse(parsedJson.data);

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
      data: JSON.parse(rawText) as unknown,
    };
  } catch {
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return {
        success: false as const,
        error: new ReplyClassificationError("Anthropic returned no JSON."),
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
            : new ReplyClassificationError("Could not parse reply JSON."),
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
