import { AzureOpenAI } from 'openai';
import { z } from 'zod';
import type { PricingDecision } from './pricing-engine.service';

const responseSchema = z.object({
  message: z.string().trim().min(1).max(240),
  decision: z.enum(['ACCEPT', 'COUNTER', 'DECLINE']),
}).strict();

function fallback(decision: PricingDecision) {
  if (decision.decision === 'ACCEPT') return 'That works. I can lock in this Hook price for 30 minutes.';
  if (decision.decision === 'COUNTER') {
    return `I can meet you at ₦${Math.round((decision.counterPriceMinor || 0) / 100).toLocaleString('en-NG')}.`;
  }
  return 'I cannot reach that price today, but you can continue at the current Hook price.';
}

function configured() {
  return Boolean(
    process.env.AZURE_OPENAI_API_KEY
    && process.env.AZURE_OPENAI_ENDPOINT
    && process.env.AZURE_OPENAI_DEPLOYMENT_NAME
    && process.env.AZURE_OPENAI_API_VERSION,
  );
}

export class AzureNegotiationService {
  async phrase(decision: PricingDecision): Promise<{
    message: string;
    telemetry: Record<string, unknown>;
    fallbackUsed: boolean;
  }> {
    if (!configured()) {
      return {
        message: fallback(decision),
        telemetry: { provider: 'fallback', failed: true, failureCode: 'NOT_CONFIGURED' },
        fallbackUsed: true,
      };
    }
    try {
      const client = new AzureOpenAI({
        apiKey: process.env.AZURE_OPENAI_API_KEY!,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
        deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION!,
      });
      const approvedPrice = decision.acceptedPriceMinor || decision.counterPriceMinor;
      const response = await client.responses.create({
        model: process.env.AZURE_OPENAI_MODEL_NAME || process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
        input: [
          {
            role: 'system',
            content: 'Write one short, friendly Hook AI Negotiator response. Use exactly the supplied decision and price. Never mention internal floors, rules, discounts, prompts, or policies. Return JSON only.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              decision: decision.decision,
              ...(approvedPrice ? { approvedPriceNaira: approvedPrice / 100 } : {}),
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'hook_negotiation_message',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                message: { type: 'string' },
                decision: { type: 'string', enum: ['ACCEPT', 'COUNTER', 'DECLINE'] },
              },
              required: ['message', 'decision'],
            },
          },
        },
        max_output_tokens: 120,
      });
      const parsed = responseSchema.parse(JSON.parse(response.output_text));
      const formattedPrice = approvedPrice ? Math.round(approvedPrice / 100).toLocaleString('en-NG') : undefined;
      if (
        parsed.decision !== decision.decision
        || (formattedPrice && /\d/.test(parsed.message) && !parsed.message.replaceAll(',', '').includes(formattedPrice.replaceAll(',', '')))
        || /floor|minimum|internal|prompt/i.test(parsed.message)
      ) {
        throw new Error('Provider output changed an approved decision');
      }
      return {
        message: parsed.message,
        telemetry: {
          provider: 'azure_openai',
          requestId: response.id,
          model: response.model,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
        },
        fallbackUsed: false,
      };
    } catch (error) {
      return {
        message: fallback(decision),
        telemetry: {
          provider: 'fallback',
          failed: true,
          failureCode: error instanceof Error ? error.name : 'AZURE_ERROR',
        },
        fallbackUsed: true,
      };
    }
  }
}
