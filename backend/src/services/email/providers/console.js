/** Dev/test provider: prints the email instead of sending it. */
async function send({ from, to, cc, subject, text }) {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[email:console] from=${from} to=${to.join(', ')}${cc ? ` cc=${cc.join(', ')}` : ''} subject="${subject}"\n${text}\n`);
  }
  return { id: null };
}

module.exports = { send };
