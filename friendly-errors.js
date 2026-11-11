// Turns core error text ("code: detail") into something a player can act on.
// The original text is kept at the end so diagnostics and support still see it.

const RULES = [
  [/^cpu_execution_failed\b.*invalid memory access/i,
    "This game crashed while running in Mochi. Mochi can't run every game yet. Tap Diagnostics to save a report before reloading."],
  [/^cpu_execution_failed\b/i,
    "Mochi couldn't keep running this game's code, so it stopped. Mochi can't run every game yet. Tap Diagnostics to save a report before reloading."],
  [/^unsupported_guest_architecture\b/i,
    "This game uses features Mochi doesn't support yet."],
  [/^(startup_timeout|timeout)\b/i,
    "The game took too long to start. Close other apps or tabs to free memory, then try again."],
  [/^missing_dependency\b/i,
    "Something this game needs is missing. Open Setup and check your keys and firmware."],
  [/^invalid_content\b/i,
    "This game file couldn't be read. It may be incomplete or damaged; try importing it again."],
  [/^(data_in_use|save_writers_active|save_edit_open)\b/i,
    "Your save data is busy right now. Stop the game or close save tools, then try again."],
  [/^recovery_session_active\b/i,
    "Mochi is still recovering from the last session. Wait a moment, then try again."],
  [/^(core_error|invalid_state)\b/i,
    "Mochi ran into a problem and stopped. Tap Diagnostics to save a report, then reload Mochi."],
];

export function playerMessage(text) {
  if (typeof text !== 'string' || !text) return text;
  const raw = text.replace(/^(Error|InvalidOperationException):\s*/i, '');
  for (const [pattern, friendly] of RULES) {
    if (pattern.test(raw)) return `${friendly} (Details: ${raw})`;
  }
  return text;
}
