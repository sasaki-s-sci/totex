/**
 * Which branches a repository asks the graph to leave out.
 *
 * The graph draws every branch a repository has now, whether or not the commit
 * it stands on is one of the ones on screen — so a checkout that has collected
 * a hundred old lines of work draws a hundred rows. `.totex/.graphignore` is
 * where that is narrowed: a list of names, read the way `.gitignore` is read,
 * kept beside the repository rather than in this window's storage so that it
 * says the same thing in the next window and on the next machine.
 *
 * The backend hands the lines over as they were written, comments and blanks
 * already gone — see `git/inspect/ignore.rs`. What one means is here, because
 * what it decides is what is drawn.
 */

/**
 * A name is matched at its own `/` boundaries.
 *
 * `dev` hides `dev/80gd2z` the way a directory in `.gitignore` hides what is
 * under it, so somebody who wants a whole namespace gone writes the namespace.
 * `*` stops at a boundary and `**` crosses one, again as git has it — and both
 * are worth having: `dev/*` is a line of work, `dev/**` is that and everything
 * cut from it.
 */
function matcherOf(pattern: string): RegExp {
  // Every character the regexp would otherwise read as its own, the two glob
  // marks aside: those are put back below.
  const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  const body = escaped
    .split("**")
    .map((part) => part.split("*").join("[^/]*"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

/** A pattern, and whether matching it hides a branch or brings it back. */
type Rule = { match: RegExp; hide: boolean };

function rulesOf(patterns: readonly string[]): Rule[] {
  return patterns.map((line) => {
    // `!` puts a name back, which is what makes a list of exceptions writable:
    // hide the namespace, keep the one branch in it still being worked on.
    const hide = !line.startsWith("!");
    return { match: matcherOf(hide ? line : line.slice(1)), hide };
  });
}

/**
 * Whether one name is left out, given the rules in the order they were written.
 *
 * The last rule that has anything to say about a name is the one that settles
 * it, so a `!` line after the pattern that swept the name up brings it back and
 * one before it does not. Every `/`-prefix of the name is offered to each rule,
 * which is what makes a namespace stand for what is under it.
 */
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

/**
 * What a repository's list comes to: the one question the layout asks of it.
 *
 * Both spellings of a branch are offered — `origin/dev/x` as well as `dev/x` —
 * so that `dev/*` reaches a branch on a remote as well as the one on this
 * machine, and `origin/*` reaches only the remote ends. A repository that asks
 * for nothing gets a question that always answers no, and no regexp is built.
 */
export function graphIgnore(patterns: readonly string[] | undefined): (
  /** How the branch is drawn: `dev/x`, or `origin/dev/x` on a remote. */
  name: string,
  /** The same branch without its remote, which is what a pair shares. */
  logicalName: string,
) => boolean {
  if (patterns === undefined || patterns.length === 0) return () => false;
  const rules = rulesOf(patterns);
  return (name, logicalName) =>
    hiddenBy(rules, name) || (logicalName !== name && hiddenBy(rules, logicalName));
}
