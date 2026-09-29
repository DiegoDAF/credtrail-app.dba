import type {
  LearnerPathwayProgressRecord,
  LearnerPathwayProgressState,
  LearnerPathwayRequirementState,
} from "@credtrail/db";
import type { HtmlEscapedString } from "hono/utils/html";

const requirementLabels: Record<LearnerPathwayRequirementState, string> = {
  met: "Complete",
  waived: "Requirement waived",
  not_recorded: "To complete",
  in_review: "Under review",
  invalidated: "Needs attention",
};

const completionMessages: Record<LearnerPathwayProgressState["_tag"], string> = {
  in_progress: "Complete the remaining requirements to finish this pathway.",
  issuing: "All requirements are complete. Your final badge is being issued automatically.",
  eligible:
    "All requirements are complete. Your institution still needs to issue your final badge.",
  issued: "Your final badge has been awarded.",
  needs_review: "All requirements are complete. Your institution is reviewing your final badge.",
  invalidated:
    "Some evidence is no longer current. Contact your institution to review your progress.",
  complete: "You have completed this pathway.",
};

/** Shows institution-defined badge groups and completion guidance on the learner dashboard. */
export const DashboardPathways = (input: {
  readonly pathways: readonly LearnerPathwayProgressRecord[];
  readonly recordPath: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null => {
  if (input.pathways.length === 0) return null;
  return (
    <section
      class="learner-dashboard__collection learner-dashboard__pathways"
      aria-labelledby="learner-pathways-title"
    >
      <header>
        <h2 id="learner-pathways-title">Your pathways</h2>
        <p>Requirements set by your institution, with your progress across courses.</p>
      </header>
      {input.pathways.map((pathway) => (
        <article class="learner-dashboard__pathway" key={pathway.enrollmentId}>
          <h3>{pathway.pathwayTitle}</h3>
          <p>{pathway.learnerDescription}</p>
          <p>{completionMessages[pathway.state._tag]}</p>
          {pathway.state._tag === "issued" ? (
            <p>
              <a href={`/badges/${encodeURIComponent(pathway.state.assertionPublicId)}`}>
                View your final badge
              </a>
            </p>
          ) : null}
          <ul class="learner-dashboard__pathway-requirements">
            {pathway.evaluation.requirements.map((requirement) => (
              <li key={requirement.requirementId}>
                <div>
                  <strong>{requirement.title}</strong>
                  {requirement.description === null ? null : <p>{requirement.description}</p>}
                </div>
                <span>{requirementLabels[requirement.state]}</span>
              </li>
            ))}
          </ul>
          {pathway.nextRequirement === null ? null : (
            <p>
              Next: <strong>{pathway.nextRequirement.title}</strong>.
            </p>
          )}
          <a href={`${input.recordPath}#active-pathways-title`}>
            View pathway details and evidence
          </a>
        </article>
      ))}
    </section>
  );
};
