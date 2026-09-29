ALTER TABLE learner_pathway_versions
  DROP CONSTRAINT learner_pathway_versions_completion_behavior_check,
  DROP CONSTRAINT learner_pathway_versions_check;

ALTER TABLE learner_pathway_versions
  ADD CONSTRAINT learner_pathway_versions_completion_behavior_check
    CHECK (completion_behavior IN ('mark_complete', 'issue_credential', 'credential_eligible', 'review_required')),
  ADD CONSTRAINT learner_pathway_versions_check CHECK (
    (completion_behavior = 'mark_complete' AND final_badge_template_id IS NULL)
    OR (completion_behavior IN ('issue_credential', 'credential_eligible', 'review_required') AND final_badge_template_id IS NOT NULL)
  );

ALTER TABLE learner_pathway_completion_handoffs
  DROP CONSTRAINT learner_pathway_completion_handoffs_behavior_check;
ALTER TABLE learner_pathway_completion_handoffs
  ADD CONSTRAINT learner_pathway_completion_handoffs_behavior_check
    CHECK (behavior IN ('mark_complete', 'issue_credential', 'credential_eligible', 'review_required'));

ALTER TABLE job_queue_messages DROP CONSTRAINT job_queue_messages_job_type_check;
ALTER TABLE job_queue_messages ADD CONSTRAINT job_queue_messages_job_type_check CHECK (
  job_type IN (
    'issue_badge', 'revoke_badge', 'import_migration_batch', 'import_learner_record_batch',
    'generate_badge_template_image', 'process_badge_rule_lifecycle',
    'process_automated_badge_rule', 'send_badge_rule_approval_notification',
    'process_learner_evidence_change', 'issue_learner_pathway_badge'
  )
);
