import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";
import { getEnv } from "@ecommerce/config";

/**
 * AI helpers on the AI SDK + OpenRouter (plan-10). Every feature degrades
 * gracefully: isAiEnabled() is false without OPENROUTER_API_KEY and callers
 * hide the UI rather than failing.
 */

export function isAiEnabled(): boolean {
  return getEnv().OPENROUTER_API_KEY.length > 0;
}

function getModel() {
  const env = getEnv();
  const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
  return openrouter.chat(env.AI_MODEL);
}

const descriptionSchema = z.object({
  description: z.string().min(1).max(1200),
});

export async function generateProductDescription(input: {
  title: string;
  categoryName?: string | null;
  tagNames?: string[];
}): Promise<string> {
  const { object } = await generateObject({
    model: getModel(),
    schema: descriptionSchema,
    prompt: [
      "You write product descriptions for an online marketplace.",
      "Write a compelling, factual 2-4 sentence description.",
      "Do not invent specifications that are not implied by the input.",
      "Plain text only, no markdown, no emoji.",
      "",
      `Product title: ${input.title}`,
      input.categoryName ? `Category: ${input.categoryName}` : null,
      input.tagNames && input.tagNames.length > 0 ? `Tags: ${input.tagNames.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    maxOutputTokens: 400,
    temperature: 0.7,
  });
  return object.description;
}

const tagsSchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(5),
});

export async function suggestTagsForProduct(input: {
  title: string;
  description: string;
  existingTagNames: string[];
}): Promise<string[]> {
  const { object } = await generateObject({
    model: getModel(),
    schema: tagsSchema,
    prompt: [
      "Pick up to 5 tags for this marketplace product, chosen ONLY from the",
      "existing tag list below. Return the exact tag strings. Empty list is fine.",
      "",
      `Existing tags: ${input.existingTagNames.join(", ") || "(none)"}`,
      `Product title: ${input.title}`,
      `Description: ${input.description.slice(0, 800)}`,
    ].join("\n"),
    maxOutputTokens: 200,
    temperature: 0.3,
  });
  const existing = new Set(input.existingTagNames.map((t) => t.toLowerCase()));
  return object.tags.filter((t) => existing.has(t.toLowerCase()));
}
