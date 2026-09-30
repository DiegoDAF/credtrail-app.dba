# Offer the same badge across courses

Use an instructor-confirmed rule for requirements such as library orientation that do not depend on grades or completion in one particular LMS course. Each instructor confirms the same published requirement. An existing award is recognized wherever the badge is offered.

## Set up the rule

1. Create a badge template and attach its artwork.
2. In **Rules**, create a rule for that badge and choose **Instructor confirms completion (no course required)**.
3. Describe what the instructor must confirm. Include enough detail for instructors in different courses to apply the same standard.
4. Review the requirement and submit it for approval. The normal approval and activation process applies. This pattern uses manual issuance and does not require a test learner or an LMS course selection.
5. Open **Course availability** for the approved rule. Offer it to every course in the institution, to an organizational area, or to selected courses. Institution-wide availability requires an explicit impact acknowledgment. Organizational availability uses the institution's course mappings and includes descendant organizational units.
6. In each eligible LMS course, use the CredTrail picker to add the published rule. A copied course can retain the same rule; it does not require a duplicate rule or badge template.

Availability controls where instructors may place and use the rule. It does not create LMS content in every course automatically.

## Confirm and issue

Open the badge in the LMS course. CredTrail loads the current learner roster and shows previous awards from across the institution. Select learners who completed the published requirement, check the completion confirmation, and issue the badge.

CredTrail records the confirming instructor, the requirement, and the approved rule version with each award. Submission checks the current roster, rule version, active placement, and course availability again. If the rule changed, reopen the badge before issuing.

Award recognition uses the badge template and the learner's normalized email address within the institution. Different LMS user IDs in different courses do not create a new achievement when the email is the same. Learners without an LMS email cannot receive a roster award. Different email addresses are not assumed to be the same person. Gradebook checks match that email to a unique learner in the rule’s LMS connection and training courses. Missing or conflicting matches require correction; an LTI launch identifier is never assumed to be a gradebook identifier.

Canvas training checks include active and completed enrollments. A learner who has finished the master course can still qualify for its badge when an instructor checks from another eligible course.

Manual roster issuance and automated rules share an award identity for the same badge and email. Repeated requests do not create another award. Previous awards remain visible as history. A renewable badge can receive a new award after it expires; suspended or revoked awards cannot be renewed until their status is resolved.

## Renew recurring training

In the rule builder's review step, enable **Require learners to renew this badge**. Set **Valid for (months)**; the default is 12. Each new award expires that many calendar months after the learner earns it. Month-end dates use the last day of the target month. Approve and activate the rule through the normal governance workflow.

The credential carries its expiry date, and the learner dashboard shows current awards and renewal due. Expired or suspended badges do not satisfy badge prerequisites or pathway requirements. Status changes and expiry refresh pathway progress. Existing credentials without an expiry date retain their original validity; changing a rule does not rewrite issued credentials.

Renewal requires evidence dated after the previous award. Automatic rules read new submissions or completed gradebook items from the master course. For a scored submission, its grade must belong to the new attempt. For a course grade or course-completion rule, every required gradebook item must have dated completion evidence; course grades also require grading of those attempts. Canvas must confirm that each required score belongs to the current submission; a later grading date alone is insufficient. Sakai gradebook dates change when an old grade is edited, so they are not accepted as proof of new training. Use an instructor-confirmed renewal rule for Sakai training until dated attempt or completion evidence is available. An old passing score, missing dates, or an incomplete retake cannot renew an award. Where the LMS cannot provide dated evidence, use instructor confirmation of new training.

When a rule offers alternative ways to qualify, one complete alternative must satisfy the renewal requirements. Exclusions continue to check all current evidence, including older training; renewal does not erase that history.

After expiry, the same approved rule can issue the renewed badge automatically or let an instructor confirm the new completion from any eligible course. The new award receives a new validity period. Duplicate requests for the same renewal produce one award, and older awards remain in the learner's history. Renewals use the same institutional badge and normalized email identity as initial awards.

## Group badges on the learner dashboard

Use **Learner pathways** to create a named group, such as First-Year Experience:

1. Give the pathway a name, learner-facing description, and program owner.
2. Choose its badge requirements. Add **How to complete** guidance for each requirement, such as where to complete orientation and whom to contact afterward. A blank guidance field uses the badge's description.
3. Choose **Award the final badge automatically** and select a final badge with artwork, or choose a completion-only or administrator-reviewed workflow.
4. Publish the pathway and enroll the intended learners.

Enrolled learners see the group on their dashboard, with complete, outstanding, waived, or review states for each requirement, completion guidance, and a link to the supporting evidence in their learner record. Progress comes from the existing pathway evaluation process as institutional evidence is recorded; learners cannot mark their own requirements complete.

## Require three trainings before a first-year seminar

Create a badge for harassment prevention, AI training, and library research, then create a First-Year badge. Attach artwork to each badge.

1. Configure each training badge to use its completion evidence. When an LMS records completion or a passing score, use an automatic rule tied to that evidence source. Offer the rule across the institution through **Course availability**. Use instructor confirmation when completion must be checked by a person.
2. Create a First-Year pathway with the three training badges as requirements. Choose **Award the final badge automatically**, select the First-Year badge, publish the pathway, and enroll the intended learners.
3. As each training badge is issued, CredTrail updates the learner's pathway. All three are required. Completing the third queues the First-Year badge automatically. Learners see the issuance status and then a link to their final badge.
4. In the seminar, place an approved rule for the First-Year badge. Its requirements should match the three training badges. The instructor opens its CredTrail roster and checks for an active First-Year award. The award is recognized even when it was issued by the pathway outside that course.

The instructor makes the seminar admission decision. This workflow does not change LMS enrollment or course-access settings.

Automatic awards use durable delivery and a stable identity for each pathway completion. Retries do not create duplicate awards. CredTrail rechecks training evidence before issuing the final badge, including inside the transaction that records the award. If evidence was suspended, revoked, or expired before issuance, the learner must satisfy the requirements again.

A pathway configured to wait for administrator issuance or review keeps that approval step. Its dashboard status tells learners that the final badge is still pending.
