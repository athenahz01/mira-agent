import { voiceStyleGuideJsonSchema } from "../lib/db/style-guide.ts";
import { generateVoiceGuide } from "../lib/llm/voice-guide.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("Skipped voice guide shape test: ANTHROPIC_API_KEY is unset.");
  process.exit(0);
}

async function main() {
  const guide = await generateVoiceGuide({
    creatorProfile: {
      handle: "athena_hz",
      display_name: "Athena Huo",
      niche_tags: ["fashion", "lifestyle", "ugc", "nyc"],
      aesthetic_keywords: ["warm-toned", "preppy-elevated"],
      bio_extract:
        "NYC-based fashion, lifestyle, and UGC creator making polished everyday content.",
      recent_post_themes: ["fit checks", "coffee shop routines", "UGC demos"],
      tier: "nano",
    },
    voiceSamples: [
      {
        source: "website",
        tag: "website",
        text: "I create warm, polished content for brands that want visuals to feel lived-in, specific, and still elevated.",
      },
      {
        source: "ig_caption",
        tag: "caption",
        text: "A tiny reset between classes: good light, a soft sweater, and finally remembering to eat lunch before 3pm.",
      },
      {
        source: "email_sent",
        tag: "gifting",
        text: "I liked how your latest collection leans into soft everyday staples. I could see it fitting naturally into a weekday outfit reel for my NYC audience.",
      },
    ],
  });

  voiceStyleGuideJsonSchema.parse(guide);
  console.log("Voice guide shape test passed.");
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown voice guide shape test failure";
  console.error(message);
  process.exitCode = 1;
});
