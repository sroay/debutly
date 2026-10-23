// The rehearsal's Mailpit, behind its login: the first link in an email to `to` that matches.
export async function mailLink(to: string, pattern: RegExp): Promise<string> {
  const base = process.env.MAIL_URL!;
  const headers = { authorization: `Basic ${Buffer.from(process.env.MAIL_LOGIN!).toString("base64")}` };
  for (let attempt = 0; attempt < 45; attempt++) {
    const search = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`, { headers });
    const { messages = [] } = (await search.json()) as { messages?: { ID: string }[] };
    for (const { ID } of messages) {
      const message = (await (await fetch(`${base}/api/v1/message/${ID}`, { headers })).json()) as { HTML?: string; Text?: string };
      const links = [...(message.HTML ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
      links.push(...((message.Text ?? "").match(/https?:\/\/\S+/g) ?? []));
      const link = links.find((l) => pattern.test(l));
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`No email to ${to} with a link matching ${pattern}`);
}
