export interface ParsedCommand {
  command: string;
  args: string;
}

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  const rawCommand = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const command = rawCommand.split("@")[0].toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  return { command, args };
}

/** /новость [анонимно] "текст" — кавычки не обязательны, но убираются, если есть. */
export function parseNewsArgs(args: string): { anonymous: boolean; text: string } | null {
  let rest = args.trim();
  let anonymous = false;

  const anonymousMatch = /^анонимно\s+/i.exec(rest);
  if (anonymousMatch) {
    anonymous = true;
    rest = rest.slice(anonymousMatch[0].length).trim();
  }

  const quoted = /^"(.+)"$/s.exec(rest);
  const text = quoted ? quoted[1].trim() : rest;

  if (!text) return null;
  return { anonymous, text };
}
