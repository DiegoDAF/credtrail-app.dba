import type { LearnerPathwayProgressRecord, LearnerPathwayRequirementState } from "@credtrail/db";
import type { HtmlEscapedString } from "hono/utils/html";

const requirementLabels: Record<LearnerPathwayRequirementState, string> = {
  met: "Complete",
  waived: "Requirement waived",
  not_recorded: "To complete",
  in_review: "Under review",
  invalidated: "Needs attention",
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
