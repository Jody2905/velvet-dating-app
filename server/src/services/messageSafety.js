// Flags common romance-scam patterns. A flag adds a gentle warning; it never blocks the message.
const RULES = [
  { flag: 'money_request', re: /\b(send|lend|wire|transfer)\b.{0,20}\b(money|cash|\$\d+)|western union|moneygram|gift ?cards?|cash ?app|crypto|bitcoin/i },
  { flag: 'contact_off_platform', re: /whats ?app|telegram|signal me|text me at|\+?\d[\d\s-]{6,}\d/i },
];

function checkMessage(body) {
  const hit = RULES.find(r => r.re.test(body));
  return hit ? hit.flag : null;
}

module.exports = { checkMessage };
