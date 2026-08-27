const CANONICAL_URL = 'https://coinbase-ivory.vercel.app';
const LEGACY_URL = 'https://crypto-signal-dashboard-chi.vercel.app';
const EXPECTED_ASSETS = ['BTC', 'ETH', 'SHIB', 'FIL', 'STX', 'DOGE', 'ARB', 'XRP'];

async function readJson(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return { response, body: await response.json() };
}

const legacyProbe = await fetch(`${LEGACY_URL}/api/version`, { redirect: 'manual' });
if (![307, 308].includes(legacyProbe.status)) {
  throw new Error(`legacy alias did not redirect: HTTP ${legacyProbe.status}`);
}

const location = legacyProbe.headers.get('location');
if (location !== `${CANONICAL_URL}/api/version`) {
  throw new Error(`legacy alias redirected to unexpected location: ${location}`);
}

const [canonicalVersion, legacyVersion, canonicalSignals, legacySignals] = await Promise.all([
  readJson(`${CANONICAL_URL}/api/version`),
  readJson(`${LEGACY_URL}/api/version`),
  readJson(`${CANONICAL_URL}/api/signals`),
  readJson(`${LEGACY_URL}/api/signals`),
]);

if (!/^[0-9a-f]{40}$/.test(canonicalVersion.body.commit)) {
  throw new Error(`canonical commit is not a full Git SHA: ${canonicalVersion.body.commit}`);
}
if (JSON.stringify(canonicalVersion.body) !== JSON.stringify(legacyVersion.body)) {
  throw new Error('aliases declare different build versions');
}
if (canonicalVersion.response.url !== `${CANONICAL_URL}/api/version` || legacyVersion.response.url !== `${CANONICAL_URL}/api/version`) {
  throw new Error('version requests did not converge on the canonical endpoint');
}

for (const [name, result] of [
  ['canonical', canonicalSignals],
  ['legacy', legacySignals],
]) {
  const symbols = result.body.assets?.map((asset) => asset.symbol);
  if (JSON.stringify(symbols) !== JSON.stringify(EXPECTED_ASSETS)) {
    throw new Error(`${name} alias returned an unexpected signals asset contract`);
  }
  if (result.response.url !== `${CANONICAL_URL}/api/signals`) {
    throw new Error(`${name} signals request did not converge on the canonical endpoint`);
  }
}

console.log(
  JSON.stringify(
    {
      canonical: CANONICAL_URL,
      legacy: LEGACY_URL,
      redirectStatus: legacyProbe.status,
      commit: canonicalVersion.body.commit,
      dataContract: canonicalVersion.body.dataContract,
      assetSymbols: EXPECTED_ASSETS,
    },
    null,
    2,
  ),
);
