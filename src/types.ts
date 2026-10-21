/** Accessibility & inclusion needs every run includes by default. */
export const INCLUSION_NEEDS = ["screen_reader", "low_vision", "slow_connection", "non_native_english"] as const;
export type InclusionNeed = (typeof INCLUSION_NEEDS)[number];

export interface Persona {
  id: string;
  name: string;
  background: string;
  goal: string;
  patience: "low" | "medium" | "high";
  techSavvy: "low" | "medium" | "high";
  /** Job role inside a business crew, e.g. "Owner" or "Content writer". */
  role?: string;
  inclusion?: InclusionNeed;
}

export interface Business {
  name: string;
  /** agency, SME, small business, freelancer, startup, enterprise team… */
  archetype: string;
  /** Role-played headcount; the crew itself is capped. */
  size: number;
  /** Monthly budget ceiling for tools like this, in USD. */
  monthlyBudget: number;
  goal: string;
}

/** Who a simulation run models: one person (B2C) or a business crew of owner + employees (B2B). */
export type CustomerUnit =
  | { kind: "individual"; id: string; person: Persona }
  | { kind: "business"; id: string; business: Business; owner: Persona; employees: Persona[] };

/** Keys a person uses to drive popups and forms; nothing that could close tabs or run shortcuts. */
export const PRESS_KEYS = ["Escape", "Enter", "Tab", "ArrowDown", "ArrowUp"] as const;
export type PressKey = (typeof PRESS_KEYS)[number];

export type Action =
  | { type: "click"; id: number }
  | { type: "fill"; id: number; text: string }
  // file: which sample to attach (a photo, or a document such as a CV); by default what the field accepts.
  | { type: "upload"; id: number; file?: "photo" | "document" }
  | { type: "goto"; path: string }
  | { type: "check_email" }
  | { type: "press"; key: PressKey }
  | { type: "wait" }
  | { type: "done"; success: boolean; note: string };

export type Signal =
  | { kind: "console_error"; message: string; url: string }
  | { kind: "page_error"; message: string; url: string }
  // startedAt/at (epoch ms) bracket the request, to match it against what a sandbox blocked meanwhile.
  // body: the start of a server error's response, which can say why (e.g. a missing API key).
  | { kind: "http_error"; status: number; requestUrl: string; url: string; startedAt?: number; at?: number; body?: string }
  | { kind: "dialog"; dialogType: string; message: string; url: string }
  // A page that took long to arrive. finished: false when the agent's wait ran out first.
  | { kind: "slow_load"; url: string; ms: number; finished: boolean; slowNetwork: boolean }
  // A file the page handed over (a report, an export): the page itself often doesn't change.
  | { kind: "download"; filename: string; url: string };

export interface InteractiveElement {
  id: number;
  role: string;
  name: string;
  tag: string;
  /** A native select's chosen option and its options, by label. */
  value?: string;
  options?: string[];
}

export interface Observation {
  url: string;
  title: string;
  elements: InteractiveElement[];
  text: string;
}

export interface ActionResult {
  blocked?: string;
  error?: string;
}

export interface Step extends ActionResult {
  index: number;
  observation: Observation;
  action: Action;
  reasoning: string;
  signals: Signal[];
  screenshotPath?: string;
  /** A goto to an address the agent typed itself, not a link from an email. */
  guessedUrl?: boolean;
}

export interface Session {
  agentId: string;
  personaName: string;
  goal: string;
  steps: Step[];
  outcome: "success" | "gave_up" | "budget_exhausted" | "error" | "not_invited" | "cancelled";
  outcomeNote: string;
  unitId?: string;
  role?: string;
  inclusion?: InclusionNeed;
  /** Tokens this session spent, and their cost when the model price is known. */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

export type Severity = "blocker" | "major" | "minor";
export type Confidence = "high" | "medium" | "low";
export type FindingKind = "http_error" | "page_error" | "console_error" | "a11y_unlabeled" | "stuck" | "slow_load" | "covered";

export interface Finding {
  signature: string;
  kind: FindingKind;
  severity: Severity;
  title: string;
  detail: string;
  pagePath: string;
  hitBy: string[];
  visitors: number;
  confidence: Confidence;
  evidence: { agentId: string; stepIndex: number }[];
  /**
   * Why every occurrence of this failure is the test environment's doing: hosts it blocked at the
   * same moment, and/or `missing key: <what the app said>` when the app reported a key the test
   * environment leaves out on purpose.
   */
  sandboxCause?: string[];
}
