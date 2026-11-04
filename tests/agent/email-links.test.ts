import { expect, it } from "vitest";
import { describeInbox, emailedLinkMeant } from "../../src/agent/loop";

const signIn = "http://127.0.0.1:54421/auth/v1/verify?token=pkce_2b4f0e9c71&type=magiclink&redirect_to=http%3A%2F%2Flocalhost%3A3000";
const confirm = "http://localhost:3000/confirm?code=8e1c4b7f20a9";

it("numbers each emailed link, so it can be opened without retyping it", () => {
  const inbox = describeInbox([{ subject: "Your sign-in link", links: [signIn] }, { subject: "Confirm your email", links: [confirm] }] as never, (l) => [signIn, confirm].indexOf(l) + 1);
  expect(inbox).toBe(`checked email → 2 emails: "Your sign-in link" links: [email link 1] ${signIn}; "Confirm your email" links: [email link 2] ${confirm}`);
});

it("opens an emailed link by its number, or from a copy with a garbled host (2026-10-25)", () => {
  const links = [signIn, confirm];
  expect(emailedLinkMeant("email link 2", links)).toBe(confirm);
  expect(emailedLinkMeant("Email Link 1", links)).toBe(signIn);
  expect(emailedLinkMeant("email link 3", links)).toBeUndefined();
  // Retyped with one host part too many, the rest exact.
  expect(emailedLinkMeant(signIn.replace("127.0.0.1", "127.0.0.0.0.1"), links)).toBe(signIn);
  // A page of the app itself is not an emailed link.
  expect(emailedLinkMeant("http://localhost:3000/login", links)).toBeUndefined();
  expect(emailedLinkMeant(signIn, links)).toBeUndefined();
});
