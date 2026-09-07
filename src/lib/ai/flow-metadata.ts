/**
 * Per-flow metadata: name, human version label, model identity, and a
 * stable key that a future slice can use to key a prompt-template
 * registry.
 *
 * Prompt-template *hash* is not computed here because Genkit hides the
 * final template string behind its DSL. Instead each flow declares a
 * PROMPT_TEMPLATE_KEY that changes whenever the human authoring it
 * intends the semantics to have changed. The version label is bumped
 * alongside (e.g. `v2`) so anyone reading an AiExecution row can tell
 * two runs apart without spelunking git history.
 *
 * If a future slice wants to compute a real content hash, export the
 * literal prompt string from each flow and hash it in a boot-time pass.
 * The AiExecution.promptTemplateHash column is already provisioned.
 */

export interface FlowMetadata {
  /** Machine-stable flow identifier — matches Genkit's flow name. */
  flowName:          string
  /** Human-readable version label; bump when the prompt/schema changes. */
  flowVersion:       string
  /** Stable template key for a future registry. Reused as promptTemplateKey. */
  promptTemplateKey: string
  modelProvider:     string
  modelName:         string
  modelVersion?:     string
}

/**
 * Registry of every AI flow the app calls. Adding a new flow means
 * adding a row here (plus wrapping the call at the ai-actions.ts
 * layer with withAIExecution).
 */
export const FLOW_METADATA: Record<string, FlowMetadata> = {
  financialDocumentExtractionFlow: {
    flowName:          'financialDocumentExtractionFlow',
    flowVersion:       'v1-slice7',
    promptTemplateKey: 'extract-financial-data.v2-citations',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
  aiIndustryCodeSuggestionFlow: {
    flowName:          'aiIndustryCodeSuggestionFlow',
    flowVersion:       'v1',
    promptTemplateKey: 'industry-code-suggestion.v1',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
  anomalyDetectionFlow: {
    flowName:          'anomalyDetectionFlow',
    flowVersion:       'v1',
    promptTemplateKey: 'anomaly-detection.v1',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
  binderQueryFlow: {
    flowName:          'binderQueryFlow',
    flowVersion:       'v1',
    promptTemplateKey: 'binder-query.v1',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
  insightsFlow: {
    flowName:          'insightsFlow',
    flowVersion:       'v1',
    promptTemplateKey: 'case-insights.v1',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
  normalizeTtmFlow: {
    flowName:          'normalizeTtmFlow',
    flowVersion:       'v1',
    promptTemplateKey: 'ttm-normalization.v1',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
  reportNarrativeFlow: {
    flowName:          'reportNarrativeFlow',
    flowVersion:       'v1',
    promptTemplateKey: 'report-narrative.v1',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
  // Slice 12 — client-request completeness detection.
  requestCompletenessFlow: {
    flowName:          'requestCompletenessFlow',
    flowVersion:       'v1',
    promptTemplateKey: 'request-completeness.v1',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
  // Slice 14 — evidence-grounded report-section narrative flow.
  reportSectionNarrativeV2Flow: {
    flowName:          'reportSectionNarrativeV2Flow',
    flowVersion:       'v1-slice14',
    promptTemplateKey: 'report-section-narrative.v2-grounded',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
  // Slice 16 — natural-language question → filter-DSL planner.
  caseSearchPlannerFlow: {
    flowName:          'caseSearchPlannerFlow',
    flowVersion:       'v1',
    promptTemplateKey: 'case-search-planner.v1-whitelisted',
    modelProvider:     'googleai',
    modelName:         'gemini-2.5-flash',
  },
}

export function metadataFor(flowName: string): FlowMetadata {
  const m = FLOW_METADATA[flowName]
  if (!m) throw new Error(`[flow-metadata] unknown flow: ${flowName}`)
  return m
}

export type FlowName = keyof typeof FLOW_METADATA
