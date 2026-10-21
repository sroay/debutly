import { randomUUID } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FixtureMail {
  to: string;
  subject: string;
  text: string;
  links: string[];
}

export interface FixtureState {
  workspaceDeleted: boolean;
  signups: string[];
  /** Emails the app "sent" (read by agents through fixtureInbox). */
  mail: FixtureMail[];
  /** Teammates who accepted an invite. */
  joined: string[];
}

export interface FixtureOptions {
  port?: number;
  /** 0.0.0.0 to serve other containers (the stack smoke test); defaults to local only. */
  host?: string;
  /** "broken" (default) keeps the seeded failing invite; "working" emails a join link. */
  invites?: "broken" | "working";
}

export interface RunningFixture {
  url: string;
  state: FixtureState;
  close: () => Promise<void>;
}

const USER_COOKIE = "fixturely_user";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function userOf(req: express.Request): string | null {
  const match = (req.headers.cookie ?? "").match(new RegExp(`(?:^|;\\s*)${USER_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Signed-in visitors get a welcome line and account links, like a real app; without that,
// real agents can't tell signup worked and keep signing up again.
const layout = (title: string, body: string, user: string | null = null) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} - Fixturely</title></head>
<body>
<nav><a href="/">Home</a> <a href="/features">Features</a> <a href="/pricing">Pricing</a> <a href="/docs">Docs</a> ${
  user ? `<a href="/dashboard">Dashboard</a> <a href="/logout">Log out</a>` : `<a href="/signup">Sign up</a>`
}</nav>
${user ? `<p role="status">Welcome, ${escapeHtml(user)}. You're signed in.</p>` : ""}
<main>${body}</main>
</body></html>`;

export function createFixtureApp(state: FixtureState, invites: FixtureOptions["invites"] = "broken") {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const pending = new Map<string, { inviter: string; email: string }>();

  app.get("/logout", (_req, res) => {
    res.clearCookie(USER_COOKIE).redirect(303, "/");
  });

  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });

  app.get("/", (req, res) => {
    const user = userOf(req);
    const cta = user ? `<a href="/pricing">Choose a plan</a>` : `<a href="/signup">Start free trial</a>`;
    res.send(layout("Home", `<h1>Fixturely</h1><p>Project management for small teams.</p>${cta}`, user));
  });

  // Uploads two ways: a plain file field, and a button in front of a hidden one (as most apps do).
  app.get("/upload", (req, res) => {
    res.send(
      layout(
        "Upload",
        `<h1>Your profile</h1>
<label for="photo">Profile photo</label><input id="photo" type="file" accept="image/*">
<button type="button" id="cv-button">Upload your CV</button><input id="cv" type="file" accept=".pdf,.doc,.docx" style="display:none">
<button type="button">Does nothing</button>
<ul id="chosen"></ul>
<script>
document.getElementById('cv-button').addEventListener('click', () => document.getElementById('cv').click());
for (const input of document.querySelectorAll('input[type=file]')) input.addEventListener('change', () => {
  for (const f of input.files) document.getElementById('chosen').insertAdjacentHTML('beforeend', '<li>' + input.id + ': ' + f.name + ' ' + f.type + ' ' + f.size + '</li>');
});
</script>`,
        userOf(req),
      ),
    );
  });

  // A report that only downloads: the page itself stays the same.
  app.get("/reports", (req, res) => {
    res.send(
      layout(
        "Reports",
        `<h1>Reports</h1>
<button type="button" id="generate">Generate weekly brief</button>
<script>
document.getElementById('generate').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['Weekly brief'], { type: 'text/plain' }));
  a.download = 'weekly-brief.txt';
  a.click();
});
</script>`,
        userOf(req),
      ),
    );
  });

  // A page that takes ?ms= milliseconds to arrive, as a heavy page does on a slow connection.
  app.get("/slow", (req, res) => {
    setTimeout(() => res.send(layout("Slow", `<h1>Finally here</h1><a href="/pricing">Pricing</a>`, userOf(req))), Number(req.query.ms ?? 0));
  });

  app.get("/features", (req, res) => {
    res.send(layout("Features", `<h1>Features</h1><ul><li>Boards</li><li>Team invites</li><li>Reports</li></ul>`, userOf(req)));
  });

  // SEEDED BUG: /docs is linked from the nav but has no route (404).

  app.get("/signup", (req, res) => {
    res.send(
      layout(
        "Sign up",
        `<h1>Create your account</h1>
<form method="post" action="/signup">
<label for="email">Work email</label><input id="email" name="email" type="email">
<label for="password">Password</label><input id="password" name="password" type="password">
<label for="team-size">Team size</label><select id="team-size" name="teamSize"><option>Just me</option><option>2-10 people</option><option>11-50 people</option></select>
<button type="submit">Create account</button>
</form>`,
        userOf(req),
      ),
    );
  });

  app.post("/signup", (req, res) => {
    const email = String(req.body.email ?? "");
    state.signups.push(email);
    res.cookie(USER_COOKIE, email, { httpOnly: true, sameSite: "lax" }).redirect(303, "/pricing");
  });

  // SEEDED BUG: startCheckout is never defined, so "Choose Studio" throws.
  app.get("/pricing", (req, res) => {
    res.send(
      layout(
        "Pricing",
        `<h1>Pricing</h1>
<section><h2>Solo</h2><p>$19/month, 1 seat</p><button onclick="location.href='/checkout?plan=solo'">Choose Solo</button></section>
<section><h2>Studio</h2><p>$49/month, 5 seats</p><button onclick="startCheckout('studio')">Choose Studio</button></section>`,
        userOf(req),
      ),
    );
  });

  app.get("/checkout", (req, res) => {
    const plan = String(req.query.plan ?? "solo");
    res.send(
      layout(
        "Checkout",
        `<h1>Checkout: ${plan}</h1>
<form method="post" action="/checkout">
<input type="hidden" name="plan" value="${plan}">
<label for="card">Card number</label><input id="card" name="card" placeholder="Test card 4242 4242 4242 4242">
<span id="country-label">Billing country</span>
<button type="button" id="country" role="combobox" aria-labelledby="country-label" aria-expanded="false" aria-controls="country-list">Choose a country</button>
<input type="hidden" name="country" id="country-value">
<div id="country-overlay" hidden style="position:fixed;inset:0;z-index:10"></div>
<div id="country-list" role="listbox" hidden style="position:relative;z-index:11;background:#fff">
<div role="option" data-value="GB">United Kingdom</div><div role="option" data-value="US">United States</div><div role="option" data-value="IN">India</div>
</div>
<script>
// A Radix-style select: options are role="option", and while it is open an overlay blocks the rest of the page.
(() => {
  const trigger = document.getElementById('country'), list = document.getElementById('country-list'), overlay = document.getElementById('country-overlay');
  const setOpen = (open) => { list.hidden = !open; overlay.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); };
  trigger.addEventListener('click', () => setOpen(list.hidden));
  overlay.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  for (const option of list.querySelectorAll('[role="option"]')) option.addEventListener('click', () => {
    document.getElementById('country-value').value = option.dataset.value; trigger.textContent = option.textContent; setOpen(false);
  });
})();
</script>
<button type="submit">Pay</button>
</form>`,
        userOf(req),
      ),
    );
  });

  app.post("/checkout", (req, res) => {
    res.redirect(303, `/dashboard?plan=${encodeURIComponent(String(req.body.plan ?? "solo"))}`);
  });

  // SEEDED BUG: the settings button has no accessible name.
  app.get("/dashboard", (req, res) => {
    res.send(
      layout(
        "Dashboard",
        `<h1>Dashboard</h1><p>Plan: ${String(req.query.plan ?? "none")}</p>
<form id="invite"><label for="invite-email">Teammate email</label><input id="invite-email" type="email"><button type="submit">Send invite</button></form>
<p id="invite-status"></p>
<button class="icon-settings"><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle></svg></button>
<button onclick="fetch('/api/workspace', { method: 'DELETE' })">Delete workspace</button>
<script>
document.getElementById('invite').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('invite-email').value;
  const res = await fetch('/api/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  document.getElementById('invite-status').textContent = res.ok ? 'Invite sent' : 'Something went wrong';
});
</script>`,
        userOf(req),
      ),
    );
  });

  // SEEDED BUG (default): invites always fail. With invites: "working" they email a join link.
  app.post("/api/invite", (req, res) => {
    if (invites !== "working") {
      res.status(500).json({ error: "internal" });
      return;
    }
    const inviter = userOf(req) ?? "someone";
    const email = String(req.body?.email ?? "").trim();
    const token = randomUUID();
    pending.set(token, { inviter, email });
    const link = `${req.protocol}://${req.get("host")}/join?token=${token}`;
    state.mail.push({ to: email, subject: `${inviter} invited you to Fixturely`, text: `Join ${inviter}'s workspace: ${link}`, links: [link] });
    res.json({ ok: true });
  });

  app.get("/join", (req, res) => {
    const invite = pending.get(String(req.query.token ?? ""));
    if (!invite) {
      res.status(404).send(layout("Invite", `<h1>This invite link is invalid or has expired</h1>`, userOf(req)));
      return;
    }
    res.send(
      layout(
        "Join",
        `<h1>Join ${escapeHtml(invite.inviter)}'s workspace</h1>
<form method="post">
<label for="name">Name</label><input id="name" name="name">
<label for="join-password">Password</label><input id="join-password" name="password" type="password">
<button type="submit">Join workspace</button>
</form>`,
        userOf(req),
      ),
    );
  });

  app.post("/join", (req, res) => {
    const token = String(req.query.token ?? "");
    const invite = pending.get(token);
    if (!invite) {
      res.status(404).send(layout("Invite", `<h1>This invite link is invalid or has expired</h1>`, userOf(req)));
      return;
    }
    pending.delete(token);
    state.joined.push(invite.email);
    res.cookie(USER_COOKIE, invite.email, { httpOnly: true, sameSite: "lax" }).redirect(303, "/dashboard");
  });

  app.delete("/api/workspace", (_req, res) => {
    state.workspaceDeleted = true;
    res.status(204).end();
  });

  return app;
}

export async function startFixture({ port = 0, host = "127.0.0.1", invites = "broken" }: FixtureOptions = {}): Promise<RunningFixture> {
  const state: FixtureState = { workspaceDeleted: false, signups: [], mail: [], joined: [] };
  const app = createFixtureApp(state, invites);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(port, host, () => resolve(s));
  });
  const { port: actualPort } = server.address() as AddressInfo;
  return {
    url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${actualPort}`,
    state,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
