/**
 * How a stage is NAMED in outgoing communication — group chats and client
 * emails — as opposed to how it is named inside JopUP.
 *
 * Recruiters say a candidate has "Reached" when the workflow says "Turn up".
 * That is a wording choice for the audience, so it lives here, keyed by the
 * stage's stable `stageKey` (names can be renamed per team; keys are not).
 * Database values, API stage names and on-screen labels are never changed.
 * Mirror: frontend/src/lib/clipboard.js (STAGE_LABEL_FOR_COPY).
 */
const OUTGOING_STAGE_LABELS = { turnup: 'Reached' };

function outgoingStageLabel(stageKey, stageName) {
  return OUTGOING_STAGE_LABELS[stageKey] || stageName;
}

module.exports = { outgoingStageLabel, OUTGOING_STAGE_LABELS };
