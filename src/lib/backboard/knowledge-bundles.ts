export interface KnowledgeDocumentRef {
  filename: string;
  repoPath: string;
  mimeType: string;
}

function kd(filename: string): KnowledgeDocumentRef {
  return {
    filename,
    repoPath: `docs/backboard/knowledge/${filename}`,
    mimeType: "text/markdown",
  };
}

/**
 * Shared RAG document bundles. Assistants attach only the bundles they need
 * so bootstrap does not duplicate every document on every role.
 */
export const KNOWLEDGE_BUNDLES = {
  GENERAL_TRANSIT: [
    kd("ttc-network-primer.md"),
    kd("simulation-methodology.md"),
    kd("product-limitations.md"),
    kd("data-provenance.md"),
  ],
  PLANNING: [
    kd("transit-scheduling-methodology.md"),
    kd("station-location-methodology.md"),
    kd("route-planning-methodology.md"),
    kd("policy-evaluation-rubric.md"),
  ],
  ACCESSIBILITY_EQUITY: [kd("accessibility-policy.md"), kd("equity-evaluation.md")],
  SAFETY_RELIABILITY: [
    kd("platform-safety-rules.md"),
    kd("reliability-methodology.md"),
    kd("event-response-playbook.md"),
  ],
  IMPACT: [
    kd("carbon-estimation.md"),
    kd("cost-methodology.md"),
    kd("infrastructure-feasibility.md"),
  ],
  CITIZEN_MODEL: [
    kd("citizen-model-limitations.md"),
    kd("citizen-reaction-methodology.md"),
    kd("freesolo-model-card.md"),
  ],
} as const;
