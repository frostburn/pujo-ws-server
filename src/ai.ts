import {
  PASS,
  SimpleGame,
  StrategyResult,
  WIDTH,
  effectiveLockout,
  puyoCount,
} from 'pujo-puyo-core';

const HEURISTIC_FAIL = -2000000;
const PREFER_LONGER = 1.06;

/**
 * Heuristic score to discourage wasting of material.
 * @param game Game state to evaluate.
 * @returns The amount of material in the playing grid.
 */
function materialCount(game: SimpleGame) {
  return puyoCount(game.screen.coloredMask);
}

function passPenalty(move: number, game: SimpleGame): number {
  if (move === PASS) {
    return Math.min(0, -30 * game.lateTimeRemaining);
  }
  return 0;
}

/**
 * Heuristic score from dropping a single puyo of every color onto the playing field and averaging the results.
 * @param game Game state to evaluate.
 * @returns Average of the highest scores achievable by dropping a single puyo and a true max bonus.
 */
function flexDroplet(game: SimpleGame): number {
  let result = 0;
  let trueMax = HEURISTIC_FAIL;
  for (let i = 0; i < game.colorSelection.length; ++i) {
    let max = HEURISTIC_FAIL;
    for (let x = 0; x < WIDTH; ++x) {
      const clone = game.clone();
      clone.screen.insertPuyo(x, 1, game.colorSelection[i]);
      max = Math.max(max, clone.resolve().score);
    }
    result += max;
    trueMax = Math.max(trueMax, max);
  }
  return (0.15 * result) / game.colorSelection.length + 0.85 * trueMax;
}

export function myFlexDropletStrategy1(game: SimpleGame): StrategyResult {
  const moves = game.availableMoves;
  // Shuffle to break ties.
  moves.sort(() => Math.random() - 0.5);

  let flexBonus = 0;
  let max = HEURISTIC_FAIL;
  let move = moves[0] || 0;
  for (let i = 0; i < moves.length; ++i) {
    const clone = game.clone();
    const tickResult = clone.playAndTick(moves[i]);
    const score =
      passPenalty(moves[i], game) +
      tickResult.score +
      PREFER_LONGER * flexDroplet(clone) +
      1.5 * materialCount(clone) +
      effectiveLockout(clone);
    if (score > max) {
      max = score;
      move = moves[i];
    }
    flexBonus += score;
  }
  flexBonus /= moves.length || 1;
  return {
    move,
    score: 0.85 * max + 0.15 * flexBonus,
  };
}

/**
 * Heuristic score from dropping a single puyo of every color onto the playing field and averaging the results.
 * @param game Game state to evaluate.
 * @returns Average of the highest scores achievable by dropping a single puyo and a true max bonus.
 */
/*
function otherFlexDroplet(game: SimpleGame): number {
  let average = 0;
  let flexMax = 0;
  let trueMax = HEURISTIC_FAIL;
  for (let i = 0; i < game.colorSelection.length; ++i) {
    let max = HEURISTIC_FAIL;
    for (let x = 0; x < WIDTH; ++x) {
      const clone = game.clone();
      clone.screen.insertPuyo(x, 1, game.colorSelection[i]);
      const score = clone.resolve().score;
      average += score;
      max = Math.max(max, score);
    }
    flexMax += max;
    trueMax = Math.max(trueMax, max);
  }
  flexMax /= game.colorSelection.length;
  average /= WIDTH * game.colorSelection.length;
  return (0.15 * flexMax + 0.85 * trueMax) * 0.95 + 0.05 * average;
}
*/

export function otherFlexDropletStrategy1(game: SimpleGame): StrategyResult {
  const moves = game.availableMoves;
  // Shuffle to break ties.
  moves.sort(() => Math.random() - 0.5);

  let flexBonus = 0;
  let max = HEURISTIC_FAIL;
  let move = moves[0] || 0;
  for (let i = 0; i < moves.length; ++i) {
    const clone = game.clone();
    const tickResult = clone.playAndTick(moves[i]);
    const score =
      passPenalty(moves[i], game) +
      tickResult.score +
      PREFER_LONGER * flexDroplet(clone) +
      1.5 * materialCount(clone) +
      effectiveLockout(clone);
    if (score > max) {
      max = score;
      move = moves[i];
    }
    flexBonus += score;
  }
  flexBonus /= moves.length || 1;
  return {
    move,
    score: 0.8 * max + 0.2 * flexBonus,
  };
}

export function myFlexDropletStrategy2(game: SimpleGame): StrategyResult {
  const moves = game.availableMoves;
  // Shuffle to break ties.
  moves.sort(() => Math.random() - 0.5);

  let flexBonus = 0;
  let max = HEURISTIC_FAIL;
  let move = moves[0] || 0;
  for (let i = 0; i < moves.length; ++i) {
    const clone = game.clone();
    const tickResult = clone.playAndTick(moves[i]);
    const score =
      passPenalty(moves[i], game) +
      tickResult.score +
      PREFER_LONGER * myFlexDropletStrategy1(clone).score;
    if (score > max) {
      max = score;
      move = moves[i];
    }
    flexBonus += score;
  }
  flexBonus /= moves.length || 1;
  return {
    move,
    score: 0.9 * max + 0.1 * flexBonus,
  };
}

export function otherFlexDropletStrategy2(game: SimpleGame): StrategyResult {
  const moves = game.availableMoves;
  // Shuffle to break ties.
  moves.sort(() => Math.random() - 0.5);

  let flexBonus = 0;
  let max = HEURISTIC_FAIL;
  let move = moves[0] || 0;
  for (let i = 0; i < moves.length; ++i) {
    const clone = game.clone();
    const tickResult = clone.playAndTick(moves[i]);
    const score =
      passPenalty(moves[i], game) +
      tickResult.score +
      PREFER_LONGER * otherFlexDropletStrategy1(clone).score;
    if (score > max) {
      max = score;
      move = moves[i];
    }
    flexBonus += score;
  }
  flexBonus /= moves.length || 1;
  return {
    move,
    score: 0.9 * max + 0.1 * flexBonus,
  };
}
