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
  /** First language, as a lang code ("ar"); English when unset. */
  language?: string;
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
export const PRESS_KEYS = ["Escape", "Enter", "Space", "Tab", "ArrowDown", "ArrowUp"] as const;
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
  // assets: the scripts and styles received by then, as sent, and how much of that came uncompressed.
  | { kind: "slow_load"; url: string; ms: number; finished: boolean; slowNetwork: boolean; assets?: { files: number; bytes: number; uncompressedBytes: number } }
  // A file the page handed over (a report, an export): the page itself often doesn't change.
  | { kind: "download"; filename: string; url: string };

/** What the browser tells assistive technology about an element. hidden: left out of the tree (e.g. aria-hidden). */
export interface AccessibleName {
  name: string;
  role: string;
  hidden: boolean;
  /** What a screen reader reads after the role (aria-describedby, a tooltip); absent when there's none. */
  description?: string;
}

export interface InteractiveElement {
  id: number;
  role: string;
  name: string;
  tag: string;
  /** What a field holds: a native select's chosen option, or a text field's text (never a password's). */
  value?: string;
  /** A native select's options, by label. */
  options?: string[];
  /** A password field with something typed in it. */
  filled?: true;
  /** Shown but not editable. */
  readOnly?: true;
  /** A checkbox, radio button or switch: on or off. */
  checked?: boolean;
  /** A control that opens something (a menu, a dropdown): open or closed. */
  expanded?: boolean;
  /** The browser's own accessible name and role (Chromium), as a screen reader would announce them. */
  ax?: AccessibleName;
  /** Named only by its placeholder: no label, aria-label or aria-labelledby. */
  nameFrom?: "placeholder";
  /** Disabled, so Tab skips it. */
  disabled?: true;
  /** Out of the tab order (tabindex -1, or inside an inert part of the page). */
  tabbable?: false;
  /** A control with no text: the icon it shows, as its markup names it ("menu", "trash"). What a sighted person sees. */
  icon?: string;
}

export interface Observation {
  url: string;
  title: string;
  elements: InteractiveElement[];
  text: string;
  /** The page's lang attribute ("" when missing), its text direction, and the share of its letters that are Arabic. */
  lang?: string;
  dir?: string;
  arabicShare?: number;
  /** The page's viewport setting when it stops pinch-zoom (user-scalable=no, maximum-scale under 2), else "". */
  zoomBlocked?: string;
}

export interface ActionResult {
  blocked?: string;
  error?: string;
  /** Keyboard only: what entirely hid the control once it had focus. */
  focusObscured?: string;
  /** Keyboard only: Enter did nothing on the button, and Space pressed it. */
  enterIgnored?: true;
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

/** A page measured at a narrow width after the low-vision agent's run (WCAG 1.4.10 Reflow). */
export interface ReflowCheck {
  url: string;
  widthPx: number;
  /** How much wider than the window the page is; 0 when it fits. */
  overflowPx: number;
  /** The element reaching furthest to the right, outside any scrolling box. */
  widest: string;
  /** Why the overflow may be allowed (e.g. it is a data table), or "". */
  exception: string;
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
  language?: string;
  /** Tokens this session spent, and their cost when the model price is known. */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  /** The low-vision agent's pages, measured again at 320 CSS pixels wide. */
  reflow?: ReflowCheck[];
}

export type Severity = "blocker" | "major" | "minor";
export type Confidence = "high" | "medium" | "low";
export type FindingKind =
  | "http_error"
  | "page_error"
  | "console_error"
  | "a11y_unlabeled"
  | "stuck"
  | "slow_load"
  | "covered"
  | "keyboard"
  | "focus_obscured"
  | "reflow"
  | "language"
  | "zoom";

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
   * same moment, `missing key: <what the app said>` when the app reported a key the test
   * environment leaves out on purpose, and/or `made-up site: <host>` when the app couldn't reach
   * the website an agent invented for its company.
   */
  sandboxCause?: string[];
  /** WCAG 2.2 success criteria the finding relates to ("4.1.2"), for a person to check. */
  wcag?: string[];
  /** The control a screen-reader finding is about, so `debutly hear` can find it again. */
  control?: { role: string; name?: string; problem: "unnamed" | "described" | "unreached" | "placeholder" | "keyboard" };
}
