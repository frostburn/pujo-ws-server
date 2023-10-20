const K_FACTOR = 32;

/** Update Elo ratings for two playes based on the result of a single game.*/
export function updateElos(ratingA, ratingB, resultA) {
  const resultB = 1 - resultA;

  const logisticFactor = Math.pow(10, (ratingB - ratingA) / 400);

  const expectedA = 1 / (1 + logisticFactor);
  const expectedB = logisticFactor / (1 + logisticFactor);

  return [
    ratingA + K_FACTOR * (resultA - expectedA),
    ratingB + K_FACTOR * (resultB - expectedB),
  ];
}
