// `.totex/.graphignore`, read like `.gitignore`: the backend strips comments
// and blanks (`git/inspect/ignore.rs`); what a line means is decided here.

// `*` stops at a `/` boundary and `**` crosses one, as git has it.
function matcherOf(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  const body = escaped
    .split("**")
    .map((part) => part.split("*").join("[^/]*"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

type Rule = { match: RegExp; hide: boolean };

function rulesOf(patterns: readonly string[]): Rule[] {
  return patterns.map((line) => {
    const hide = !line.startsWith("!");
    return { match: matcherOf(hide ? line : line.slice(1)), hide };
  });
}

// Last matching rule wins; every `/`-prefix of the name is offered, so a
// namespace stands for what is under it.
function hiddenBy(rules: readonly Rule[], name: string): boolean {
  const parts = name.split("/");
  const steps: string[] = [];
  for (let cut = 1; cut <= parts.length; cut++) steps.push(parts.slice(0, cut).join("/"));

  let hidden = false;
  for (const rule of rules) {
    if (steps.some((step) => rule.match.test(step))) hidden = rule.hide;
  }
  return hidden;
}

/** Both spellings are offered, so `dev/*` reaches remote ends and `origin/*` only them. */
export function graphIgnore(
  patterns: readonly string[] | undefined,
): (name: string, logicalName: string) => boolean {
  if (patterns === undefined || patterns.length === 0) return () => false;
  const rules = rulesOf(patterns);
  return (name, logicalName) =>
    hiddenBy(rules, name) || (logicalName !== name && hiddenBy(rules, logicalName));
}
