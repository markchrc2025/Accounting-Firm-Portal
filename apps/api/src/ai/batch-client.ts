/**
 * batch-client.ts — the one place the Portal talks to Anthropic (U11 R3). It sends
 * a pile as a Message Batch (half price; results within 24 hours) and reads the
 * results back. It is injectable (AI_BATCH_CLIENT), so every test uses a fake and
 * nothing in a test VM calls the real API.
 *
 * The key: ANTHROPIC_API_KEY, from the API service's environment only. It is read
 * here, handed to the SDK, and never logged, printed, returned or stored.
 * Docs: https://platform.claude.com/docs/en/build-with-claude/batch-processing
 *       https://platform.claude.com/docs/en/api/messages/batches/results
 */
import Anthropic from "@anthropic-ai/sdk";

/** One request in a batch: custom_id is the scan file's id (a uuid fits
 *  ^[a-zA-Z0-9_-]{1,64}$), params are ordinary Messages parameters. */
export interface BatchRequest {
  custom_id: string;
  params: Record<string, unknown>;
}

export interface BatchUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  } | null;
}

/** One line of a batch's results (the SDK's MessageBatchIndividualResponse). */
export interface BatchResultLine {
  custom_id: string;
  result:
    | {
        type: "succeeded";
        message: {
          stop_reason?: string | null;
          content: Array<{ type: string; text?: string }>;
          usage: BatchUsage;
        };
      }
    | { type: "errored"; error?: { error?: { type?: string; message?: string } } }
    | { type: "canceled" }
    | { type: "expired" };
}

export interface AiBatchClient {
  createBatch(requests: BatchRequest[]): Promise<{ id: string }>;
  retrieveBatch(id: string): Promise<{ id: string; processing_status: string }>;
  batchResults(id: string): AsyncIterable<BatchResultLine>;
}

/** The real client. Built only when the key is set; otherwise every call refuses. */
export class AnthropicBatchClient implements AiBatchClient {
  private readonly sdk: Anthropic | null;

  constructor(apiKey: string | undefined) {
    this.sdk = apiKey ? new Anthropic({ apiKey, maxRetries: 2 }) : null;
  }

  private require(): Anthropic {
    if (!this.sdk) throw new Error("The AI key is not set.");
    return this.sdk;
  }

  async createBatch(requests: BatchRequest[]): Promise<{ id: string }> {
    const batch = await this.require().messages.batches.create({
      requests:
        requests as unknown as Anthropic.Messages.Batches.BatchCreateParams["requests"],
    });
    return { id: batch.id };
  }

  async retrieveBatch(id: string): Promise<{ id: string; processing_status: string }> {
    const b = await this.require().messages.batches.retrieve(id);
    return { id: b.id, processing_status: b.processing_status };
  }

  async *batchResults(id: string): AsyncIterable<BatchResultLine> {
    for await (const line of await this.require().messages.batches.results(id)) {
      yield line as unknown as BatchResultLine;
    }
  }
}
