# Guandan 掼蛋 — with a coach

A playable Guandan table in the browser, backed by an engine that plays a strong
game and reviews every move you make: what it cost you, what it would have
played instead, and why.

Play it here: **https://0xwenmoon.github.io/guandan-coach/**

```bash
npm install               # jsdom, for the headless UI tests
npm start                 # local dev server at http://localhost:8765
npm test                  # 94 tests, no browser needed
npm run bench             # engine strength check
```

Plain ES modules, no build step — GitHub Pages serves the files as they are.
A static server is required even locally, because module workers do not load
over `file://`. Every push to `main` runs the suite and, if it passes, deploys.

## What you get

- A full 4-player match: you sit South, **North is your partner**, West and East
  are opponents.
- **Coach panel** — after each of your moves: a verdict (Best / Good / Fine /
  Inaccuracy / Mistake / Blunder), the cost in levels, the engine's reasoning,
  and its ranked alternatives.
- **Hint** — ask before you commit, and it selects its choice in your hand.
- **Arranging your hand** — one column per rank, cards standing vertically, the
  way Guandan players actually hold them. **Group** pins a set of cards together
  so a full house you have decided on stays put; **同花顺** finds and highlights
  straight flushes, cycling if you have more than one.
- A running tally of how often you found the engine's first choice.

## Rules implemented

Two decks, 108 cards, 27 each.

| | |
|---|---|
| Combinations | single, pair, triple, 三带二 full house, 顺子 straight (5), 木板 three consecutive pairs, 钢板 two consecutive triples |
| Bombs | 4-of-a-kind … 10-of-a-kind, 同花顺 straight flush, 四大天王 (all four jokers) |
| Bomb order | 4-bomb < 5-bomb < **straight flush** < 6-bomb < 7-bomb < … < four kings |
| Level card | the current level's rank jumps above A, below the jokers — but keeps its natural rank inside straights and runs |
| Wildcard 逢人配 | both ♥ level cards substitute for any card **except a joker**; alone, a wildcard is simply the level card |
| Ace | plays high or low: A2345, AA2233, AAA222, and 10JQKA |
| 接风 | when a player goes out and the trick comes back around, their partner takes the free lead |
| Deal ends | as soon as one team has both players out |
| Scoring | partner finishes 2nd → +3, 3rd → +2, 4th → +1 |
| Tribute 进贡 | losers hand over their highest card (♥level is exempt); 双下 pays two, 单下 pays one |
| 抗贡 | holding both big jokers between the payers cancels tribute |
| 还贡 | the receiver returns a card of 10 or lower; the player who paid the first-place finisher leads |
| Winning | levels stop at A; win a deal while already at A to take the match |
| Failing at A | three failed attempts at A drop that team back to 2 |

**Variant notes.** Guandan house rules differ, and these are the choices made
here: A is allowed low in 木板 and 钢板 (not only in straights); straights are
fixed at 5 cards and runs at 3 pairs / 2 triples; reaching A never overshoots;
winning at A needs only 头游, not a double-up. All of it lives in `src/game.js`
and `src/combos.js` if you want it different.

## How the bot plays

Guandan has ~10^30 deals and hidden hands, so it cannot be solved — nobody has,
and this does not claim to. What it does instead is what strong card-game
engines do:

1. **Determinize.** Sample the three hidden hands at random, consistent with
   everything actually observable (cards already played, tribute that changed
   hands, exact hand sizes).
2. **Play it out** with a fast heuristic policy — lead low and long, never
   overtake your own partner, hoard controlling cards and wildcards, spend a
   bomb when an opponent is about to go out.
3. **Average.** Score each sampled deal by the level swing it produced (+3 to
   −3) and pick the best average. Every candidate move is evaluated on the
   *same* sampled deals, which cuts the variance sharply.

Measured (`npm run bench`): the rollout policy beats random legal play **95%**
of deals (+2.77 levels/deal over 200 deals). The search on top of it beats the
bare policy **71%** of deals at only 6 samples — indicative on 24 deals rather
than conclusive, and it gets stronger with the Normal/Strong settings the UI
uses.

Folk strategy is adopted only when it measures. 晚炸不如早炸 ("bombing late is
worse than bombing early") is a standard Guandan maxim; implemented as a policy
change and played head to head against the hoard-the-bomb policy it won
**53.96% of 2500 deals** (+0.21 levels/deal) — outside the 48–52% band a coin
flip would produce, so it stayed. Re-run it with `node bench.js policy 2500`.

The engine runs in a Web Worker, and **the snapshot it receives has every hand
but its own redacted to bare card counts** (`src/serialize.js`) — it cannot see
your cards even by accident. There is a test that asserts this.

## How the coach explains itself

Nothing is improvised. The verdict is the level cost the search measured between
your move and the best one. Each reason is a checked fact — a structural property
of your hand, or something countable from the cards already played — and carries
the Guandan principle it comes from, so the advice is transferable rather than a
one-off remark:

| | |
|---|---|
| 先出小牌 | lead small, keep the big cards back |
| 晚炸不如早炸 | bombing late is worse than bombing early |
| 情况不明，对子先行 | when the table is unclear, probe with a pair |
| 记断张 | count the gaps — a rank you hold none of is bomb material |
| 帮对家走牌 | if you cannot go out, get your partner out |
| 不盖对家 | never take a trick off your own partner |
| 留牌权 | the lead is worth more than the trick |
| 配牌 | keep your combinations intact |
| 算轮次 | count how many turns your hand still needs |

`src/knowledge.js` does the counting a strong player does in their head: which
cards are unaccounted for, whether your K is now the best single left, which
ranks are still whole enough to be a bomb (the 断张 warning), and whose race the
deal has become. Those facts are shown every move, not only when you err.

The panel also says when it is *unsure*: if the top two lines are within 0.2 of
a level, it tells you the verdict is a lean rather than a ruling.

## Layout

```
index.html  styles.css             markup and styling
app.js                             bootstrap: build views, wire controls
ui/store.js                        one state object, one way to change it
ui/controller.js                   the game loop as an explicit state machine
ui/engine-client.js                two worker channels, generation guard
ui/dom.js                          el / text / toggle / reconcile (no innerHTML)
ui/views/                          hand, table, coach, log, modal, cards
src/cards.js       deck, ranking, the level card and wildcard
src/combos.js      combination types, wildcard resolution, comparison
src/moves.js       legal move generation
src/eval.js        hand decomposition into 手数 (turns needed)
src/knowledge.js   card counting: what is unseen, what is now unbeatable
src/game.js        match state machine: tricks, 接风, tribute, levels
src/bot.js         determinized Monte Carlo search
src/coach.js       move review and reasoning
src/serialize.js   the redacting snapshot sent to the worker
src/worker.js      + engine-api.js — the engine off the UI thread
test/              94 tests, including a headless run of the real page
bench.js           policy-vs-policy strength measurement
```

### View layer

`app.js` does not own state. The store holds one object; the controller is the
only thing that mutates it; views subscribe and redraw. Three properties fall
out of that:

- **Cards keep their DOM nodes.** Views reconcile by card id rather than
  rebuilding, so a redraw does not destroy focus or scroll — and card
  animations become possible, because the element that was in your hand is the
  same element that lands on the table.
- **Async work is generation-guarded.** Every engine request records the
  generation it began in; starting a new match or deal bumps it and terminates
  the workers. A reply that arrives for a game that no longer exists is
  discarded rather than applied. (Before this, restarting mid-turn threw an
  uncaught error and killed the game loop.)
- **The coach never delays the table.** Reviews and hints run on their own
  worker, so a 700ms review does not sit in front of the next bot's move.

## Known gaps

- The bot does not yet infer voids from passes ("West passed on a 7, so West has
  no single above a 7"). That is the single biggest strength win available, and
  it belongs in `sampleHands`.
- No persistence — a refresh starts a new match.
- Tribute card choice is automatic for you (highest card, as the rules require);
  only the return card is yours to pick.
