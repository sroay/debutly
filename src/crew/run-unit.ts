import type { Inbox } from "../inbox/types";
import type { Business, CustomerUnit, Persona, Session } from "../types";

/** Runs one agent in its own browser context; `brief` joins its system prompt. */
export type RunAgent = (persona: Persona, goal: string, brief: string | undefined) => Promise<Session>;

export interface UnitDeps {
  runAgent: RunAgent;
  emailOf: (persona: Persona) => string;
  inbox?: Inbox;
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

const companyBrief = (b: Business) =>
  `You work at ${b.name}, ${article(b.archetype)} ${b.archetype} of about ${b.size} people. Its budget for tools like this is $${b.monthlyBudget} a month. Company goal: ${b.goal}.`;

export function ownerGoal(goal: string, team: { name: string; role?: string; email: string }[]): string {
  if (!team.length) return goal;
  const who = team.map((t) => `${t.name} (${t.role ?? "Teammate"}) at ${t.email}`).join("; ");
  return `${goal}\nOnce you are set up, invite your teammates by email so they can use it too: ${who}.`;
}

// A teammate who lands in an empty workspace of their own has not joined anything, even if the
// invite page said "accepted"; that must not count as success.
export const employeeGoal = (role: string, owner: string, company: string) =>
  `${owner} has invited you to use this product at ${company}. Check your email for the invite, accept it and set up your account. Then check that you are in ${company}'s shared workspace: you should see what ${owner} set up there, such as the company details or the items they added. If you only see an empty workspace of your own, joining did not work: report that as a failure, not success. If you are in, do one task a ${role} would typically do here. Finish when you have done that or when you would give up.`;

const tag = (s: Session, unitId: string, p: Persona): Session => ({ ...s, unitId, role: p.role, inclusion: p.inclusion, language: p.language });
const notInvited = (unitId: string, p: Persona, why: string): Session =>
  tag({ agentId: p.id, personaName: p.name, goal: "", steps: [], outcome: "not_invited", outcomeNote: why }, unitId, p);

/**
 * One customer unit. An individual runs once. A business crew runs its owner first (who is told
 * whom to invite), then, in parallel and each in its own browser, only the employees whose invite
 * actually reached their inbox, sharing the company brief and what the owner reported.
 */
export async function runUnit(unit: CustomerUnit, goal: string, deps: UnitDeps): Promise<Session[]> {
  if (unit.kind === "individual") return [tag(await deps.runAgent(unit.person, goal, undefined), unit.id, unit.person)];

  const { business, owner, employees } = unit;
  const brief = companyBrief(business);
  const team = employees.map((e) => ({ name: e.name, role: e.role, email: deps.emailOf(e) }));
  const ownerSession = tag(
    await deps.runAgent(owner, ownerGoal(goal, team), `${brief}\nYou run ${business.name} and decide which plan and how many seats to buy.`),
    unit.id,
    owner,
  );
  if (!employees.length) return [ownerSession];
  const { inbox } = deps;
  if (!inbox) return [ownerSession, ...employees.map((e) => notInvited(unit.id, e, "No test inbox, so teammates cannot receive invites."))];

  const shared = `${brief}\n${owner.name} (the owner) reported: "${ownerSession.outcomeNote}"`;
  const rest = await Promise.all(
    employees.map(async (e) => {
      const mail = await inbox.latest(deps.emailOf(e)).catch(() => []);
      if (!mail.length) return notInvited(unit.id, e, `No invite email arrived after ${owner.name} finished.`);
      return tag(await deps.runAgent(e, employeeGoal(e.role ?? "teammate", owner.name, business.name), shared), unit.id, e);
    }),
  );
  return [ownerSession, ...rest];
}
