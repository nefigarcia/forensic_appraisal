'use server'
/**
 * Request-item completeness detection.
 *
 * Given a RequestItem description and the file names + inferred types
 * of every document currently attached to it, return a suggestion for
 * whether the upload satisfies the request.
 *
 * The output is deliberately advisory. The reviewer sees the suggestion
 * plus an `isConfident` flag; the RequestItem status is NEVER auto-
 * transitioned to ACCEPTED on the basis of an AI verdict. That echoes
 * the Slice-7 anti-hallucination pattern: uncertain output is
 * *labelled* uncertain and stays in the reviewer's queue.
 */
import { ai } from '@/ai/genkit'
import { z } from 'genkit'

const InputSchema = z.object({
  requestTitle:       z.string(),
  requestDescription: z.string().optional(),
  requestCategory:    z.string().optional(),
  attachedFiles: z.array(z.object({
    name:     z.string(),
    mimeType: z.string().optional(),
    sizeKb:   z.number().optional(),
  })),
})

const OutputSchema = z.object({
  verdict:    z.enum(['AUTO_COMPLETE', 'NEEDS_HUMAN', 'INSUFFICIENT']),
  isConfident: z.boolean(),
  reason:      z.string(),
})

export type CompletenessInput  = z.infer<typeof InputSchema>
export type CompletenessOutput = z.infer<typeof OutputSchema>

export async function assessCompleteness(input: CompletenessInput): Promise<CompletenessOutput> {
  return completenessFlow(input)
}

const prompt = ai.definePrompt({
  name: 'requestCompletenessPrompt',
  input: { schema: InputSchema },
  output: { schema: OutputSchema },
  config: {
    safetySettings: [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
    ],
  },
  prompt: `You are an accountant reviewing a client "prepared-by-client" (PBC) request.

Given the request and the list of files a client has uploaded to satisfy it,
judge whether the upload plausibly satisfies the ask, ONLY based on the file
names and metadata provided. You do NOT have the file contents.

Return one of:
  - AUTO_COMPLETE  when the file name(s) clearly match the ask and there is a
                   reasonable expectation that a human reviewer will accept.
  - INSUFFICIENT   when the files are clearly the wrong artifact (e.g. a
                   photo when a tax return is requested).
  - NEEDS_HUMAN    for anything ambiguous.

Set isConfident=true ONLY when the match is unambiguous. When file names are
generic ("document.pdf", "scan.pdf"), set isConfident=false and return
NEEDS_HUMAN — the reviewer must judge.

Never fabricate details you cannot see. If in doubt, return NEEDS_HUMAN.

Request title:       {{requestTitle}}
Request description: {{requestDescription}}
Request category:    {{requestCategory}}
Attached files (JSON):
{{attachedFiles}}`,
})

const completenessFlow = ai.defineFlow(
  { name: 'requestCompletenessFlow', inputSchema: InputSchema, outputSchema: OutputSchema },
  async (input) => {
    const { output } = await prompt({
      ...input,
      attachedFiles: JSON.stringify(input.attachedFiles) as any,
    })
    return output!
  },
)
