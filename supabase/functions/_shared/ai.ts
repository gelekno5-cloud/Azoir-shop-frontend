// ─────────────────────────────────────────────────────────────────────────────
// Azoir — OpenAI generation (job sheet + customer confirmation)
// Uses OpenAI Chat Completions API via fetch (Deno-compatible)
// Env: OPENAI_API_KEY
// ─────────────────────────────────────────────────────────────────────────────

import type { QuoteRequest, AiOutput } from "./types.ts";

const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// ── Internal Job Sheet ────────────────────────────────────────────────────────

export async function generateJobSheet(
  quote: QuoteRequest,
  jobRef: string,
  paidAt: string,
): Promise<AiOutput> {
  const prompt = buildJobSheetPrompt(quote, jobRef, paidAt);
  return callOpenAI(prompt, 1500);
}

function buildJobSheetPrompt(
  q: QuoteRequest,
  jobRef: string,
  paidAt: string,
): string {
  return `You are the production coordinator at Azoir & Co, a luxury custom jewellery studio.
Generate a concise, professional internal job sheet for the design team.

FORMAT: Plain text, clearly structured with labelled sections. No markdown headers — use CAPS labels.

DATA:
Job Ref: ${jobRef}
Payment Date: ${paidAt}
Customer: ${q.customer_name}
Email: ${q.email}
Phone: ${q.phone ?? "N/A"}
Country: ${q.country ?? "N/A"}
Preferred Contact: ${q.contact_method ?? "email"}
Metal: ${q.metal ?? "Not specified"}
Stones / Gems: ${q.stones ?? "Not specified"}
Vision / Brief: ${q.notes ?? "Not provided"}
Reference Photos: ${q.reference_links ?? "None"}

TASK:
1. CUSTOMER SUMMARY — one sentence describing the client and their piece.
2. DESIGN BRIEF — 3–5 bullet points distilling the key requirements for the designer.
3. TECHNICAL FLAGS — any production considerations (metal type, stone sourcing, complexity notes). If none, write "No flags."
4. NEXT STEPS — three actions the design team should take within 48 hours.
5. CONTACT NOTE — how and when to reach the client based on their preferred method.

Keep the entire sheet under 400 words. Professional, direct, no fluff.`;
}

// ── Customer Confirmation ─────────────────────────────────────────────────────

export async function generateCustomerConfirmation(
  quote: QuoteRequest,
  jobRef: string,
  channel: "email" | "sms" | "whatsapp",
): Promise<AiOutput> {
  const prompt = buildConfirmationPrompt(quote, jobRef, channel);
  return callOpenAI(prompt, 500);
}

function buildConfirmationPrompt(
  q: QuoteRequest,
  jobRef: string,
  channel: "email" | "sms" | "whatsapp",
): string {
  const channelInstructions: Record<string, string> = {
    email: "Write a warm, professional email body (no subject line). 3–4 short paragraphs. Formal but friendly tone. Sign off as 'The Azoir & Co Design Team'.",
    sms: "Write a single SMS message under 160 characters. Include the job ref. Friendly, concise.",
    whatsapp: "Write a WhatsApp message. 2–3 short paragraphs. Conversational but professional. Use plain text only — no markdown. Sign off as 'Azoir & Co'.",
  };

  return `You are a customer service representative at Azoir & Co, a luxury custom jewellery studio.
Write a payment confirmation message for a customer who just paid their $59 design fee.

Channel: ${channel.toUpperCase()}
${channelInstructions[channel]}

CUSTOMER DETAILS:
Name: ${q.customer_name.split(" ")[0]} (first name only)
Job Ref: ${jobRef}
Piece type hint: ${q.metal ? `${q.metal} piece` : "custom piece"}${q.stones ? `, with ${q.stones}` : ""}

KEY MESSAGES TO INCLUDE:
- Payment received, design process has begun
- Job reference is ${jobRef}
- Our designers will send 3 concept designs within 2–4 business days
- They are welcome to reply with any questions

Do NOT invent facts or make specific promises about timelines beyond "2–4 business days".
Output ONLY the message text — nothing else.`;
}

// ── OpenAI API call ───────────────────────────────────────────────────────────

async function callOpenAI(prompt: string, maxTokens: number): Promise<AiOutput> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return {
    content,
    model: data.model ?? MODEL,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}
