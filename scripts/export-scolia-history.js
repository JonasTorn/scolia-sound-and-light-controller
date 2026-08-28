/**
 * Scolia History Exporter
 *
 * Paste this entire script into the Chrome DevTools Console while logged into
 * game.scoliadarts.com as Laser (or any account that played every game).
 *
 * It will:
 *   1. Page through all finished games via /api/games
 *   2. Filter to games played on the Digiwise HQ board
 *   3. Fetch per-game details (/api/games/{id}) in parallel
 *   4. Extract wins, 180s, and highest checkout per player
 *   5. Download scolia-history.json — drop it in the project root
 *
 * Re-run any time you want to refresh historical data.
 */
(async () => {
  // ── Config ──────────────────────────────────────────────────────────────────
  const BOARD_ID     = '67a322937482b642fa656d8a'; // Digiwise HQ board ID
  const SEASON_START = '2026-08-10';               // ignore games before this date
  const LIMIT        = 10;  // Scolia API caps list responses at 10 per page
  const CONCURRENCY  = 8;   // parallel detail fetches

  // ── Step 1: Paginate /api/games to collect all summaries ───────────────────
  console.log('⏳ Fetching game list…');

  const npParams = Array.from({ length: 8 }, (_, i) => `numberOfPlayers[${i}]=${i + 1}`).join('&');

  const allSummaries = [];
  let offset = 0;
  let total  = Infinity;

  while (offset < Math.min(total, 10000)) {
    const url = `/api/games?${npParams}&offset=${offset}&limit=${LIMIT}&outcome=Finished`;
    const res  = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      console.error('❌ List request failed:', res.status, await res.text());
      break;
    }
    const data = await res.json();

    if (!isFinite(total)) {
      total = data.count ?? 0;
      console.log(`   Account total: ${total} finished games`);
    }

    const batch = (data.data ?? []);
    const boardBatch = batch.filter(g =>
      g.boardId === BOARD_ID && g.startTime >= SEASON_START,
    );
    allSummaries.push(...boardBatch);

    offset += batch.length;
    console.log(`   List: ${offset}/${total} scanned, ${allSummaries.length} on Digiwise HQ`);

    if (batch.length === 0 || offset >= total) break;
  }

  if (allSummaries.length === 0) {
    console.error('❌ No games found for board', BOARD_ID, '— check BOARD_ID constant');
    return;
  }
  console.log(`✅ Found ${allSummaries.length} Digiwise HQ games. Fetching details…`);

  // ── Step 2: Fetch game details in parallel batches ─────────────────────────
  // Rate limit is 120 req/window (~49s). 8 requests + 4s sleep ≈ 2 req/s → safe.
  const BATCH_DELAY_MS = 4000;
  const allDetails = [];

  for (let i = 0; i < allSummaries.length; i += CONCURRENCY) {
    const batch = allSummaries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async g => {
        try {
          const r = await fetch(`/api/games/${g._id}`, { credentials: 'include' });
          if (r.status === 429) { console.warn(`  ⚠ Rate limited on ${g._id} — will be missing`); return null; }
          if (!r.ok) { console.warn(`  ⚠ Detail ${g._id} returned ${r.status}`); return null; }
          return await r.json();
        } catch (e) {
          console.warn(`  ⚠ Detail ${g._id} threw: ${e}`);
          return null;
        }
      }),
    );
    allDetails.push(...results.filter(Boolean));
    console.log(`   Details: ${allDetails.length}/${allSummaries.length}`);
    if (i + CONCURRENCY < allSummaries.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // ── Step 3: Parse each game into a normalised record ──────────────────────
  function sectorScore(sector) {
    const s = String(sector ?? '').toUpperCase().trim();
    if (s === 'BULL' || s === '50') return 50;
    if (s === '25' || s === 'S25') return 25;
    const m = s.match(/^([SDT])(\d+)$/);
    if (!m) return 0;
    const mult = { S: 1, D: 2, T: 3 }[m[1]] ?? 0;
    return mult * parseInt(m[2], 10);
  }

  function getRoundStats(history, userId) {
    let oneEighties = 0, hundredPlus = 0, highestRound = 0;
    for (const set of history?.sets ?? []) {
      for (const leg of set.legs ?? []) {
        for (const round of leg.rounds ?? []) {
          for (const visit of round) {
            if (visit.userId !== userId) continue;
            const darts = visit.throwTriplet ?? [];
            const score = darts.reduce((s, d) => s + sectorScore(d.sector), 0);
            if (score === 180) oneEighties++;
            if (score >= 100) hundredPlus++;
            if (score > highestRound) highestRound = score;
          }
        }
      }
    }
    return { oneEighties, hundredPlus, highestRound };
  }

  const games = allDetails.map(game => {
    const idToNick = {};
    for (const p of game.participants ?? []) idToNick[p._id] = p.nickname;

    // winnerIds is present in the detail response at the top level
    const winnerIds = game.winnerIds ?? game.history?.winnerPlayerUserIds ?? [];

    const perPlayer = {};

    if (game.type === 'X01' && Array.isArray(game.statistics)) {
      // X01: Scolia pre-computes some stats; compute round stats from raw history
      for (const ps of game.statistics) {
        const nick = idToNick[ps.userId];
        if (!nick) continue;
        const st = ps.statistics ?? {};
        const rs = getRoundStats(game.history, ps.userId);
        perPlayer[nick] = {
          won:             winnerIds.includes(ps.userId) || st.winner === true,
          oneEighties:     st['180'] ?? rs.oneEighties,
          highestCheckout: st.highestFinish ?? 0,
          eliminations:    0,
          eliminated:      0,
          hundredPlus:     rs.hundredPlus,
          highestRound:    rs.highestRound,
        };
      }
    } else if (game.type === 'Elimination') {
      // Elimination: Scolia pre-computes stats in statistics array
      const statsByUserId = {};
      for (const ps of game.statistics ?? []) statsByUserId[ps.userId] = ps.statistics ?? {};
      for (const p of game.participants ?? []) {
        const st = statsByUserId[p._id] ?? {};
        const rs = getRoundStats(game.history, p._id);
        perPlayer[p.nickname] = {
          won:             winnerIds.includes(p._id),
          oneEighties:     rs.oneEighties,
          highestCheckout: 0,
          eliminations:    st.eliminations ?? st.numberOfEliminations ?? 0,
          eliminated:      st.eliminated ?? st.numberOfTimesEliminated ?? st.timesEliminated ?? 0,
          hundredPlus:     rs.hundredPlus,
          highestRound:    rs.highestRound,
        };
      }
    } else {
      // Other modes: wins only
      for (const p of game.participants ?? []) {
        perPlayer[p.nickname] = {
          won:             winnerIds.includes(p._id),
          oneEighties:     0,
          highestCheckout: 0,
          eliminations:    0,
          eliminated:      0,
          hundredPlus:     0,
          highestRound:    0,
        };
      }
    }

    return {
      _id:       game._id,
      type:      game.type,
      startTime: game.startTime,
      players:   (game.participants ?? []).map(p => p.nickname),
      perPlayer,
    };
  });

  // ── Step 4: Download JSON ─────────────────────────────────────────────────
  const output = {
    fetchedAt: new Date().toISOString(),
    boardId:   BOARD_ID,
    boardName: 'Digiwise HQ',
    games,
  };

  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'scolia-history.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Summary
  const byType = games.reduce((acc, g) => {
    acc[g.type] = (acc[g.type] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n✅ Done! Downloaded scolia-history.json`);
  console.log(`   ${games.length} games total:`, byType);
  console.log(`   Drop the file in the project root, then restart the app.`);
})();
