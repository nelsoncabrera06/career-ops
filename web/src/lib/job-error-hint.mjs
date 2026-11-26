// Classifies WHY a worker job ended in error and picks the matching hint.
// Reads ONLY the job's terminal step label — the exact, structured message
// job-store.tsx (client) or /api/run (server) set when the run ended — never
// the free-form assistant output. Scanning accumulated assistant text used to
// false-positive: career-ops evaluates AI/tech job postings, so the output
// routinely contains words like "credential", "sign-in", "authenticate" as
// ordinary JD/CV prose, unrelated to whether the CLI itself is signed in.
//
// Terminal labels this classifies against (see job-store.tsx / api/run/route.ts):
//   Real not-configured / auth failure -> "auth":
//     "No CLI configured — open Config"                                   (job-store.tsx, no cliId)
//     raw CLI stderr matched for auth keywords                            (api/run/route.ts stderr handler)
//     "The CLI exited with an error — is it installed and authenticated?"
//     "The CLI produced no output — is it installed and authenticated? (...)"
//   Plan/quota exhausted (opencode: "Free usage limit reached") -> "quota":
//     "The CLI exited with an error: {the CLI's own stderr line}"
//   Connection dropped mid-stream, CLI never got a chance to fail -> "connection":
//     "Connection error"                                                  (job-store.tsx)
//   Page reload orphaned a running job -> "interrupted":
//     "Interrupted (page reloaded)"                                       (job-store.tsx restore effect)
//   Everything else (bad input, missing CV, no report written, etc.) -> null;
//   the error text itself is the explanation.

// "auth" as a bare substring matched inside unrelated words like "author" —
// career-ops evaluates AI/tech job postings, so a terminal label can
// legitimately read something like "Failed to parse author metadata".
// authenticat\w* matches authenticate/authenticated/authentication (the
// actual terminal-label forms listed above) without matching author/authority.
const AUTH_PATTERN =
  /authenticat\w*|login|sign[ -]?in|credential|api[ -]?key|unauthorized|no cli configured/i;

// An exhausted model quota is NOT an auth failure, and yet the canned "no
// output" label ends in "is it installed and authenticated?" — so it matched
// AUTH_PATTERN and told the user to sign in to a CLI that was already signed
// in (opencode: "Free usage limit reached. Connect a provider or subscribe to
// OpenCode Go"). That is why quota is tested FIRST: the honest cause is the
// plan, and the fix is a different model or a wait, never a login.
const QUOTA_PATTERN = /usage limit|quota|rate limit|out of credits|credit balance/i;

const HINTS = {
  quota: {
    kind: "quota",
    text: "The model behind this run is out of quota — switch models (set CAREER_OPS_MODEL_OPENCODE=provider/model) or wait for the limit to reset, then re-run.",
  },
  auth: { kind: "auth", text: "Sign your CLI in from Config, then re-run." },
  connection: { kind: "connection", text: "Lost connection to the local server — re-run." },
  interrupted: { kind: "interrupted", text: "The run was interrupted — re-run it." },
};

/** The message set on the job's last step — the authoritative terminal cause. */
function lastStepLabel(job) {
  if (!job || job.status !== "error") return "";
  const steps = job.steps || [];
  return steps[steps.length - 1]?.label ?? "";
}

/** Pick the hint (or null) for an errored job, based on its terminal label only. */
export function jobErrorHint(job) {
  const label = lastStepLabel(job);
  if (!label) return null;
  if (label === "Connection error") return HINTS.connection;
  if (label === "Interrupted (page reloaded)") return HINTS.interrupted;
  if (QUOTA_PATTERN.test(label)) return HINTS.quota;
  if (AUTH_PATTERN.test(label)) return HINTS.auth;
  return null;
}
