import type { EmailMessage, Inbox } from "../src/inbox/types";
import type { FixtureState } from "./server";

/** The fixture's sent mail as agents' inboxes, so crew tests need no Mailpit. */
export function fixtureInbox(state: FixtureState): Inbox {
  return {
    async latest(address: string): Promise<EmailMessage[]> {
      return state.mail
        .filter((m) => m.to.toLowerCase() === address.toLowerCase())
        .reverse()
        .map(({ subject, text, links }) => ({ subject, text, links }));
    },
  };
}
