"use client";

import { useEffect, useState } from "react";

const FORMATS = {
  datetime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  date: { day: "numeric", month: "short", year: "numeric" },
} as const;

/** A time in the viewer's own time zone. The server renders UTC first; the browser corrects it. */
export function LocalTime({ iso, format = "datetime" }: { iso: string; format?: keyof typeof FORMATS }) {
  const utc = new Intl.DateTimeFormat("en-GB", { ...FORMATS[format], timeZone: "UTC" }).format(new Date(iso));
  const [text, setText] = useState(`${utc} UTC`);
  useEffect(() => {
    setText(new Intl.DateTimeFormat("en-GB", FORMATS[format]).format(new Date(iso)));
  }, [iso, format]);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
