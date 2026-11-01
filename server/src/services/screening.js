// Screening provider adapter.
//
// In production, replace `mockProvider` with a call to a licensed background-check
// provider (registries, watchlists, records). The rest of the app only depends on the
// shape returned here: { provider, hits: [{ list, record, comparison }] }.
//
// Rules this module enforces:
//   * Matching uses the VERIFIED legal name + date of birth, never a photo.
//   * A hit is classified, not acted on. Humans decide (see routes/moderation.js).

function compare(identity, record) {
  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return [
    { field: 'Legal name', verified: identity.legal_name, record: record.name,
      result: norm(identity.legal_name) === norm(record.name) ? 'match' : 'no_match' },
    { field: 'Date of birth', verified: identity.date_of_birth, record: record.dob || 'unknown',
      result: !record.dob ? 'check' : identity.date_of_birth === record.dob ? 'match' : 'no_match' },
  ];
}

// Severity: exact name + DOB = high. Name only = medium (likely false match, still reviewed).
function severityFor(comparison) {
  const name = comparison.find(c => c.field === 'Legal name').result;
  const dob = comparison.find(c => c.field === 'Date of birth').result;
  if (name === 'match' && dob === 'match') return 'high';
  if (name === 'match') return 'medium';
  return 'low';
}

// Demo provider. `scenario` lets you exercise each path without real data.
async function mockProvider(identity, scenario = 'clear') {
  const records = {
    clear: [],
    registry: [{ list: 'sex_offender_registry', name: identity.legal_name, dob: identity.date_of_birth }],
    watchlist: [{ list: 'public_wanted_notice', name: identity.legal_name, dob: '1979-02-14' }],
  }[scenario] || [];
  return {
    provider: 'mock',
    hits: records.map(r => ({ list: r.list, record: { name: r.name, dob: r.dob }, comparison: compare(identity, r) })),
  };
}

async function screen(identity, opts = {}) {
  const result = await mockProvider(identity, opts.scenario);
  const hits = result.hits
    .map(h => ({ ...h, severity: severityFor(h.comparison) }))
    .filter(h => h.severity !== 'low');
  return { provider: result.provider, hits };
}

module.exports = { screen, compare, severityFor };
