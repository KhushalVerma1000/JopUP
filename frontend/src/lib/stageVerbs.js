// What the main button on a candidate card says. It names the ACTION the tap
// performs ("Schedule Interview") rather than a vague "Move". Keyed by the
// stable stageKey of the stage being moved TO, because stage names can be
// renamed per team. Unknown or custom stages fall back to "Move to <name>".
const VERB = {
  screening: 'Start Screening',
  lineup: 'Line Up',
  turnup: 'Mark Reached',
  interview: 'Schedule Interview',
  offer: 'Make Offer',
  joined: 'Mark Joined',
};

export function nextStepLabel(stage) {
  if (!stage) return '';
  return VERB[stage.stageKey] || `Move to ${stage.name}`;
}
